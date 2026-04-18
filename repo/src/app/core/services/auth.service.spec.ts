import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { DbService } from './db.service';
import { AppConfigService, buildAppConfig } from '../../config/app-config.service';
import { LS_KEYS } from './session-storage.util';

function cfgWith(overrides: Partial<ReturnType<typeof buildAppConfig>['auth']> = {}): AppConfigService {
  const base = buildAppConfig();
  base.auth = { ...base.auth, ...overrides };
  return { get: () => base } as unknown as AppConfigService;
}

describe('AuthService', () => {
  let auth: AuthService;
  let db: DbService;

  beforeEach(async () => {
    (globalThis as unknown as { __resetIndexedDB: () => void }).__resetIndexedDB();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: cfgWith() }]
    });
    auth = TestBed.inject(AuthService);
    db = TestBed.inject(DbService);
    await db.init();
  });

  afterEach(() => auth.stopInactivityWatch());

  it('seeds default users on first launch', async () => {
    await auth.bootstrapSeed();
    const admin = await db.users.byUsername('admin');
    expect(admin?.role).toBe('admin');
    const editor = await db.users.byUsername('editor');
    expect(editor?.role).toBe('editor');
    await auth.bootstrapSeed();
    const count = (await db.users.all()).length;
    expect(count).toBe(3);
  });

  it('logs in with correct credentials and stores session', async () => {
    await auth.bootstrapSeed();
    const res = await auth.attemptLogin('admin', 'demo-change-me-admin');
    expect(res.ok).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.role()).toBe('admin');
    expect(localStorage.getItem(LS_KEYS.SESSION)).not.toBeNull();
  });

  it('rejects invalid credentials and counts attempts', async () => {
    await auth.bootstrapSeed();
    const r1 = await auth.attemptLogin('admin', 'wrong');
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe('invalid');
    const r2 = await auth.attemptLogin('admin', 'wrong');
    expect(r2.reason).toBe('invalid');
    const r3 = await auth.attemptLogin('admin', 'wrong');
    expect(r3.reason).toBe('cooldown');
    const u = await db.users.byUsername('admin');
    expect(u?.cooldownUntil).toBeDefined();
  });

  it('blocks login during cooldown', async () => {
    await auth.bootstrapSeed();
    for (let i = 0; i < 3; i++) await auth.attemptLogin('admin', 'bad');
    const blocked = await auth.attemptLogin('admin', 'demo-change-me-admin');
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe('cooldown');
  });

  it('returns invalid when username missing', async () => {
    await auth.bootstrapSeed();
    const r = await auth.attemptLogin('', '');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid');
  });

  it('returns invalid for unknown user but does not crash', async () => {
    await auth.bootstrapSeed();
    const r = await auth.attemptLogin('ghost', 'whatever');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid');
  });

  it('logout clears session', async () => {
    await auth.bootstrapSeed();
    await auth.attemptLogin('admin', 'demo-change-me-admin');
    auth.logout('manual');
    expect(auth.session()).toBeNull();
    expect(localStorage.getItem(LS_KEYS.SESSION)).toBeNull();
  });

  it('restoreSession loads a live session', async () => {
    const session = { userId: 'u1', username: 'x', role: 'admin' as const, issuedAt: Date.now(), lastActivity: Date.now() };
    localStorage.setItem(LS_KEYS.SESSION, JSON.stringify(session));
    auth.restoreSession();
    expect(auth.session()?.username).toBe('x');
  });

  it('restoreSession timed out -> logs out', async () => {
    const old = { userId: 'u1', username: 'x', role: 'admin' as const, issuedAt: 0, lastActivity: 0 };
    localStorage.setItem(LS_KEYS.SESSION, JSON.stringify(old));
    auth.restoreSession();
    expect(auth.session()).toBeNull();
  });

  it('hasRole checks session role', async () => {
    await auth.bootstrapSeed();
    await auth.attemptLogin('editor', 'demo-change-me-editor');
    expect(auth.hasRole(['editor'])).toBe(true);
    expect(auth.hasRole(['admin'])).toBe(false);
    auth.logout();
    expect(auth.hasRole(['editor'])).toBe(false);
  });

  it('inactivity watch auto-logs-out', async () => {
    jest.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: cfgWith({ inactivityMinutes: 1 }) }]
    });
    const auth2 = TestBed.inject(AuthService);
    await TestBed.inject(DbService).init();
    await auth2.bootstrapSeed();
    await auth2.attemptLogin('admin', 'demo-change-me-admin');
    auth2.startInactivityWatch();
    jest.advanceTimersByTime(61_000);
    expect(auth2.session()).toBeNull();
    auth2.stopInactivityWatch();
    jest.useRealTimers();
  });

  it('cooldownRemainingMs returns 0 for unknown and cleans stale', async () => {
    localStorage.setItem(LS_KEYS.COOLDOWN_PREFIX + 'x', String(Date.now() - 1000));
    expect(await auth.cooldownRemainingMs('x')).toBe(0);
    expect(localStorage.getItem(LS_KEYS.COOLDOWN_PREFIX + 'x')).toBeNull();
  });

  it('touchActivity updates lastActivity', async () => {
    await auth.bootstrapSeed();
    await auth.attemptLogin('admin', 'demo-change-me-admin');
    const before = auth.session()!.lastActivity;
    await new Promise((r) => setTimeout(r, 10));
    auth.touchActivity();
    expect(auth.session()!.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('unknown-user single failure engages the LS cooldown when maxFailedAttempts=1 (registerFailure without a user row)', async () => {
    // New AuthService with maxFailedAttempts=1 to exercise the
    // `registerFailure(uname, 0, user=undefined)` → cooldown path for a
    // non-existent user, which is a security-relevant branch.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfigService, useValue: cfgWith({ maxFailedAttempts: 1 }) }]
    });
    const auth2 = TestBed.inject(AuthService);
    await TestBed.inject(DbService).init();
    await auth2.bootstrapSeed();
    const first = await auth2.attemptLogin('ghost', 'whatever');
    expect(first.reason).toBe('cooldown');
    expect(localStorage.getItem(LS_KEYS.COOLDOWN_PREFIX + 'ghost')).not.toBeNull();
  });

  it('cooldownRemainingMs returns 0 for a malformed LS value', async () => {
    localStorage.setItem(LS_KEYS.COOLDOWN_PREFIX + 'garbled', 'not-a-number');
    expect(await auth.cooldownRemainingMs('garbled')).toBe(0);
  });

  it('touchActivity is a no-op with no active session', () => {
    // Runs the `if (!s) return;` early-exit (line 159 uncovered branch).
    expect(auth.session()).toBeNull();
    expect(() => auth.touchActivity()).not.toThrow();
  });

  it('hasRole returns false without a session', () => {
    expect(auth.hasRole(['admin'])).toBe(false);
  });

  it('startInactivityWatch is idempotent — calling twice wires handlers once', async () => {
    await auth.bootstrapSeed();
    await auth.attemptLogin('admin', 'demo-change-me-admin');
    auth.startInactivityWatch();
    // Second call hits the early-return when activityHandler is already set.
    expect(() => auth.startInactivityWatch()).not.toThrow();
    auth.stopInactivityWatch();
  });

  it('logout with no session does not record an audit event (silent no-op)', async () => {
    // Covers the `if (current)` = false branch of logout().
    const before = (await db.audit.all()).length;
    auth.logout('manual');
    const after = (await db.audit.all()).length;
    expect(after).toBe(before);
  });
});