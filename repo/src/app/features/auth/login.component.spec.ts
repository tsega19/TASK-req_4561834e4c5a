import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/services/auth.service';
import { AppConfigService, buildAppConfig } from '../../config/app-config.service';
import { SessionInfo } from '../../core/models/models';

function makeAuthStub(overrides: Partial<{
  session: SessionInfo | null;
  attemptLoginResult: Awaited<ReturnType<AuthService['attemptLogin']>>;
  throwOnAttempt: boolean;
}> = {}): { stub: Partial<AuthService>; attemptSpy: jest.Mock } {
  const session = signal<SessionInfo | null>(overrides.session ?? null);
  const attemptSpy = jest.fn(async () => {
    if (overrides.throwOnAttempt) throw new Error('boom');
    return overrides.attemptLoginResult ?? { ok: true };
  });
  return {
    stub: { session, attemptLogin: attemptSpy } as unknown as Partial<AuthService>,
    attemptSpy
  };
}

function mount(authStub: Partial<AuthService>, routerNav = jest.fn().mockResolvedValue(true)) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: AppConfigService, useValue: { get: () => buildAppConfig() } as AppConfigService },
      { provide: AuthService, useValue: authStub },
      { provide: Router, useValue: { navigate: routerNav } as unknown as Router }
    ]
  });
  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  return { fixture, routerNav };
}

describe('LoginComponent', () => {
  afterEach(() => jest.useRealTimers());

  it('renders the sign-in form with username, passphrase, and a submit button', () => {
    const { stub } = makeAuthStub();
    const { fixture } = mount(stub);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="login-username"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="login-passphrase"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="login-submit"]')?.textContent).toContain('Sign in');
  });

  it('successful login navigates to /projects and clears the passphrase', async () => {
    const { stub, attemptSpy } = makeAuthStub({ attemptLoginResult: { ok: true } });
    const { fixture, routerNav } = mount(stub);
    fixture.componentInstance.username = 'admin';
    fixture.componentInstance.passphrase = 'demo-change-me-admin';
    await fixture.componentInstance.submit();
    expect(attemptSpy).toHaveBeenCalledWith('admin', 'demo-change-me-admin');
    expect(routerNav).toHaveBeenCalledWith(['/projects']);
    expect(fixture.componentInstance.passphrase).toBe('');
  });

  it('invalid credentials show an inline error with remaining-attempt count', async () => {
    const { stub } = makeAuthStub({ attemptLoginResult: { ok: false, reason: 'invalid', attemptsLeft: 2 } });
    const { fixture } = mount(stub);
    fixture.componentInstance.username = 'admin';
    fixture.componentInstance.passphrase = 'wrong';
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const err = fixture.nativeElement.querySelector('[data-testid="login-error"]') as HTMLElement;
    expect(err.textContent).toMatch(/Invalid credentials/);
    expect(err.textContent).toMatch(/2 attempt/);
  });

  it('cooldown response locks the submit button and shows mm:ss countdown', async () => {
    jest.useFakeTimers();
    const until = Date.now() + 125_000; // 2m 05s
    const { stub } = makeAuthStub({ attemptLoginResult: { ok: false, reason: 'cooldown', cooldownUntil: until } });
    const { fixture } = mount(stub);
    fixture.componentInstance.username = 'admin';
    fixture.componentInstance.passphrase = 'x';
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector('[data-testid="login-submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toContain('Locked');
    const cd = fixture.nativeElement.querySelector('[data-testid="login-cooldown"]') as HTMLElement;
    expect(cd.textContent).toMatch(/\d+:\d{2}/);
    fixture.componentInstance.ngOnDestroy();
  });

  it('redirects already-authenticated users to /projects during ngOnInit', async () => {
    const session: SessionInfo = { userId: 'u', username: 'admin', role: 'admin', issuedAt: 1, lastActivity: 1 };
    const { stub } = makeAuthStub({ session });
    const nav = jest.fn().mockResolvedValue(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AppConfigService, useValue: { get: () => buildAppConfig() } as AppConfigService },
        { provide: AuthService, useValue: stub },
        { provide: Router, useValue: { navigate: nav } as unknown as Router }
      ]
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    // ngOnInit is async — await the microtask.
    await fixture.componentInstance.ngOnInit();
    expect(nav).toHaveBeenCalledWith(['/projects']);
  });

  it('displays an "Unexpected error" message when attemptLogin throws', async () => {
    const { stub } = makeAuthStub({ throwOnAttempt: true });
    const { fixture } = mount(stub);
    fixture.componentInstance.username = 'admin';
    fixture.componentInstance.passphrase = 'x';
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    const err = fixture.nativeElement.querySelector('[data-testid="login-error"]') as HTMLElement;
    expect(err.textContent).toMatch(/Unexpected error/);
  });

  it('submit is a no-op when another submit is already in flight (busy guard)', async () => {
    let resolveLogin!: (v: { ok: boolean }) => void;
    const pending = new Promise<{ ok: boolean }>((r) => { resolveLogin = r; });
    const attemptSpy = jest.fn(() => pending);
    const stub = { session: signal<SessionInfo | null>(null), attemptLogin: attemptSpy } as unknown as Partial<AuthService>;
    const { fixture } = mount(stub);
    // Kick off a submit and leave it pending.
    const first = fixture.componentInstance.submit();
    // Second call while busy — should bail early without another attemptLogin call.
    await fixture.componentInstance.submit();
    expect(attemptSpy).toHaveBeenCalledTimes(1);
    resolveLogin({ ok: true });
    await first;
  });
});
