import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DiagnosticsComponent } from './diagnostics.component';
import { DbService } from '../../core/services/db.service';
import { AuthService } from '../../core/services/auth.service';
import { AppConfigService, buildAppConfig } from '../../config/app-config.service';
import { AuditService } from '../../core/services/audit.service';
import { SessionInfo } from '../../core/models/models';

function mount() {
  TestBed.resetTestingModule();
  const session = signal<SessionInfo | null>({ userId: 'u', username: 'admin', role: 'admin', issuedAt: 1, lastActivity: 1 });
  TestBed.configureTestingModule({
    imports: [DiagnosticsComponent],
    providers: [
      { provide: AppConfigService, useValue: { get: () => buildAppConfig() } as AppConfigService },
      { provide: AuthService, useValue: { session, role: () => 'admin' } as unknown as AuthService }
    ]
  });
  return TestBed.createComponent(DiagnosticsComponent);
}

describe('DiagnosticsComponent', () => {
  beforeEach(() => {
    (globalThis as unknown as { __resetIndexedDB: () => void }).__resetIndexedDB();
  });

  it('renders storage / counts / performance / health-check / audit sections', async () => {
    const fixture = mount();
    await TestBed.inject(DbService).init();
    await fixture.componentInstance.refresh();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Storage');
    expect(el.textContent).toContain('Element counts');
    expect(el.textContent).toContain('Performance');
    expect(el.textContent).toContain('Health check');
    expect(el.textContent).toContain('Audit timeline');
    expect(el.querySelector('[data-testid="diag-run-health"]')).not.toBeNull();
  });

  it('runHealthCheck records a diagnostics.healthcheck.ok audit event and surfaces the result', async () => {
    const fixture = mount();
    const db = TestBed.inject(DbService);
    await db.init();
    fixture.detectChanges();
    await fixture.componentInstance.runHealthCheck();
    fixture.detectChanges();
    const audit = await TestBed.inject(AuditService).list();
    expect(audit.some((a) => a.action === 'diagnostics.healthcheck.ok')).toBe(true);
    expect(fixture.componentInstance.lastCheck()?.ok).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="diag-health-result"]')).not.toBeNull();
  });

  it('records a diagnostics.alert.storage event exactly once when storage crosses the configured warn threshold', async () => {
    const fixture = mount();
    const db = TestBed.inject(DbService);
    await db.init();
    // Stub storageEstimate to hand back a value above the default warn threshold (75%).
    (db as unknown as { storageEstimate: () => Promise<unknown> }).storageEstimate = async () => ({ usage: 90, quota: 100, percent: 90 });
    await fixture.componentInstance.refresh();
    await fixture.componentInstance.refresh(); // Second refresh — debounce must suppress a second alert.
    const audit = await TestBed.inject(AuditService).list();
    const alerts = audit.filter((a) => a.action === 'diagnostics.alert.storage');
    expect(alerts.length).toBe(1);
    expect(alerts[0].details).toMatch(/90\.0%/);
  });

  it('does not record a storage alert when usage stays below the threshold', async () => {
    const fixture = mount();
    const db = TestBed.inject(DbService);
    await db.init();
    (db as unknown as { storageEstimate: () => Promise<unknown> }).storageEstimate = async () => ({ usage: 10, quota: 100, percent: 10 });
    await fixture.componentInstance.refresh();
    const audit = await TestBed.inject(AuditService).list();
    expect(audit.filter((a) => a.action === 'diagnostics.alert.storage').length).toBe(0);
  });

  it('prettyBytes formats bytes / KB / MB / GB correctly', () => {
    const fixture = mount();
    const c = fixture.componentInstance;
    expect(c.prettyBytes(500)).toBe('500 B');
    expect(c.prettyBytes(2048)).toMatch(/KB$/);
    expect(c.prettyBytes(2 * 1024 * 1024)).toMatch(/MB$/);
    expect(c.prettyBytes(3 * 1024 * 1024 * 1024)).toMatch(/GB$/);
  });
});
