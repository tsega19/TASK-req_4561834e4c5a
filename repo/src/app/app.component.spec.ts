import '../test-setup';
import { TestBed } from '@angular/core/testing';
import { Router, NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { signal } from '@angular/core';
import { AppComponent } from './app.component';
import { AuthService } from './core/services/auth.service';
import { DbService } from './core/services/db.service';
import { LoggerService } from './logging/logger.service';
import { SessionInfo } from './core/models/models';

function mount(opts: {
  session?: SessionInfo | null;
  initError?: Error;
  initialUrl?: string;
} = {}) {
  TestBed.resetTestingModule();
  const session = signal<SessionInfo | null>(opts.session ?? null);
  const events$ = new Subject<unknown>();

  const auth = {
    session,
    bootstrapSeed: jest.fn(async () => undefined),
    restoreSession: jest.fn(),
    startInactivityWatch: jest.fn(),
    logout: jest.fn()
  };
  const db = { init: jest.fn(async () => { if (opts.initError) throw opts.initError; }) };
  const router = {
    events: events$.asObservable(),
    navigate: jest.fn().mockResolvedValue(true),
    url: opts.initialUrl ?? '/projects',
    createUrlTree: () => ({}),
    serializeUrl: () => ''
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), recent: jest.fn(() => []) };

  TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      { provide: AuthService, useValue: auth as unknown as AuthService },
      { provide: DbService, useValue: db as unknown as DbService },
      { provide: Router, useValue: router as unknown as Router },
      { provide: LoggerService, useValue: logger as unknown as LoggerService }
    ]
  });
  return { fixture: TestBed.createComponent(AppComponent), auth, db, router, events$ };
}

describe('AppComponent', () => {
  it('ngOnInit boots the db, seeds users, restores session, starts inactivity watch, flips ready', async () => {
    const { fixture, auth, db } = mount();
    await fixture.componentInstance.ngOnInit();
    expect(db.init).toHaveBeenCalled();
    expect(auth.bootstrapSeed).toHaveBeenCalled();
    expect(auth.restoreSession).toHaveBeenCalled();
    expect(auth.startInactivityWatch).toHaveBeenCalled();
    expect(fixture.componentInstance.ready).toBe(true);
  });

  it('ngOnInit still flips ready=true if the boot sequence throws', async () => {
    const { fixture } = mount({ initError: new Error('idb boom') });
    await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.ready).toBe(true);
    const logger = TestBed.inject(LoggerService) as unknown as { error: jest.Mock };
    expect(logger.error).toHaveBeenCalled();
  });

  it('canDiag allows admin and editor, denies reviewer', () => {
    const { fixture } = mount();
    const c = fixture.componentInstance;
    expect(c.canDiag('admin')).toBe(true);
    expect(c.canDiag('editor')).toBe(true);
    expect(c.canDiag('reviewer')).toBe(false);
  });

  it('logout calls auth.logout("manual") and navigates to /login', () => {
    const { fixture, auth, router } = mount({
      session: { userId: 'u', username: 'x', role: 'admin', issuedAt: 1, lastActivity: 1 }
    });
    fixture.componentInstance.logout();
    expect(auth.logout).toHaveBeenCalledWith('manual');
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('navigation subscription redirects to /login when session is null and url is not /login', async () => {
    const { fixture, router, events$ } = mount({ initialUrl: '/projects' });
    await fixture.componentInstance.ngOnInit();
    events$.next(new NavigationEnd(1, '/projects', '/projects'));
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('navigation subscription does NOT redirect when already on /login', async () => {
    const { fixture, router, events$ } = mount({ initialUrl: '/login' });
    await fixture.componentInstance.ngOnInit();
    events$.next(new NavigationEnd(1, '/login', '/login'));
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('navigation subscription does NOT redirect when a session is present', async () => {
    const { fixture, router, events$ } = mount({
      session: { userId: 'u', username: 'x', role: 'admin', issuedAt: 1, lastActivity: 1 },
      initialUrl: '/projects'
    });
    await fixture.componentInstance.ngOnInit();
    events$.next(new NavigationEnd(1, '/projects', '/projects'));
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
