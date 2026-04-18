import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { BackupComponent } from './backup.component';
import { BackupService, BACKUP_RESTORE_MAX_BYTES } from './backup.service';
import { NotificationService } from '../../core/services/notification.service';
import { LoggerService } from '../../logging/logger.service';

function mount(opts: {
  exportImpl?: () => Promise<unknown>;
  restoreImpl?: (b: unknown) => Promise<void>;
} = {}) {
  TestBed.resetTestingModule();
  const svc = {
    export: jest.fn(opts.exportImpl ?? (async () => ({ version: 1, exportedAt: 1, stores: {} }))),
    restore: jest.fn(opts.restoreImpl ?? (async () => undefined))
  };
  const notif = { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), recent: jest.fn(() => []) };

  TestBed.configureTestingModule({
    imports: [BackupComponent],
    providers: [
      { provide: BackupService, useValue: svc as unknown as BackupService },
      { provide: NotificationService, useValue: notif as unknown as NotificationService },
      { provide: LoggerService, useValue: logger as unknown as LoggerService }
    ]
  });
  return { fixture: TestBed.createComponent(BackupComponent), svc, notif, logger };
}

function fileWithSize(size: number, name = 'bundle.json', text = '{"version":1,"exportedAt":1,"stores":{}}'): File {
  const f = new File([text], name, { type: 'application/json' });
  Object.defineProperty(f, 'size', { value: size, configurable: true });
  Object.defineProperty(f, 'text', { value: async () => text, configurable: true });
  return f;
}

function fakeEvent(file: File | null): Event {
  const input = document.createElement('input');
  input.type = 'file';
  if (file) Object.defineProperty(input, 'files', { value: [file], configurable: true });
  else Object.defineProperty(input, 'files', { value: [], configurable: true });
  return { target: input } as unknown as Event;
}

describe('BackupComponent', () => {
  beforeEach(() => {
    (globalThis as unknown as { URL: { createObjectURL: () => string; revokeObjectURL: () => void } }).URL.createObjectURL = jest.fn(() => 'blob:mock');
    (globalThis as unknown as { URL: { revokeObjectURL: (u: string) => void } }).URL.revokeObjectURL = jest.fn();
  });

  it('renders export + restore cards and a human-readable max-size label', () => {
    const { fixture } = mount();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="backup-export"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="backup-restore"]')).not.toBeNull();
    expect(fixture.componentInstance.maxBytesLabel).toMatch(/MB$/);
  });

  it('doExport calls svc.export and toasts success on happy path', async () => {
    const { fixture, svc, notif } = mount();
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await fixture.componentInstance.doExport();
    expect(svc.export).toHaveBeenCalled();
    expect(notif.success).toHaveBeenCalledWith('Backup exported.');
    clickSpy.mockRestore();
  });

  it('doExport surfaces errors through the notification + logger', async () => {
    const { fixture, notif, logger } = mount({ exportImpl: async () => { throw new Error('nope'); } });
    await fixture.componentInstance.doExport();
    expect(notif.error).toHaveBeenCalledWith('Export failed.');
    expect(logger.error).toHaveBeenCalled();
  });

  it('doRestore does nothing when no file is picked', async () => {
    const { fixture, svc } = mount();
    await fixture.componentInstance.doRestore(fakeEvent(null));
    expect(svc.restore).not.toHaveBeenCalled();
  });

  it('doRestore rejects oversized bundles and logs a warning', async () => {
    const { fixture, notif, logger, svc } = mount();
    const ev = fakeEvent(fileWithSize(BACKUP_RESTORE_MAX_BYTES + 1));
    await fixture.componentInstance.doRestore(ev);
    expect(svc.restore).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    expect(notif.error).toHaveBeenCalledWith(expect.stringMatching(/too large/));
  });

  it('doRestore rejects empty bundles', async () => {
    const { fixture, notif, svc } = mount();
    const ev = fakeEvent(fileWithSize(0));
    await fixture.componentInstance.doRestore(ev);
    expect(svc.restore).not.toHaveBeenCalled();
    expect(notif.error).toHaveBeenCalledWith('Backup bundle is empty.');
  });

  it('doRestore parses JSON and calls svc.restore on happy path', async () => {
    const { fixture, svc, notif } = mount();
    const ev = fakeEvent(fileWithSize(40));
    await fixture.componentInstance.doRestore(ev);
    expect(svc.restore).toHaveBeenCalled();
    expect(notif.success).toHaveBeenCalledWith('Backup restored. Reload to see changes.');
  });

  it('doRestore surfaces parse / service failures through notification.error + logger', async () => {
    const { fixture, notif, logger } = mount({
      restoreImpl: async () => { throw new Error('boom'); }
    });
    const ev = fakeEvent(fileWithSize(40));
    await fixture.componentInstance.doRestore(ev);
    expect(notif.error).toHaveBeenCalledWith(expect.stringMatching(/Restore failed/));
    expect(logger.error).toHaveBeenCalled();
  });
});
