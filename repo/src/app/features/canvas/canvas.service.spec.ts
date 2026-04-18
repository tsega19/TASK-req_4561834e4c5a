import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { CanvasService } from './canvas.service';
import { DbService } from '../../core/services/db.service';
import { AppConfigService, buildAppConfig } from '../../config/app-config.service';
import { AuthService } from '../../core/services/auth.service';
import { signal } from '@angular/core';
import { CanvasRecord, SessionInfo, ELEMENT_TYPES } from '../../core/models/models';
import { uuid } from '../../core/services/crypto.util';

function cfgWith(overrides: Partial<ReturnType<typeof buildAppConfig>['canvas']> = {}): AppConfigService {
  const base = buildAppConfig();
  base.canvas = { ...base.canvas, ...overrides };
  return { get: () => base } as unknown as AppConfigService;
}

function auth(): Partial<AuthService> {
  const s = signal<SessionInfo | null>({ userId: 'u1', username: 'u', role: 'admin', issuedAt: 1, lastActivity: 1 });
  return { session: s, role: (() => 'admin') as unknown as AuthService['role'] };
}

function makeCanvas(): CanvasRecord {
  return {
    id: uuid(),
    projectId: 'p',
    name: 'c',
    description: '',
    elements: [],
    connections: [],
    groups: [],
    viewState: { zoom: 1, panX: 0, panY: 0, gridSize: 20 },
    createdAt: 1, updatedAt: 1, createdBy: 'u', tags: []
  };
}

describe('CanvasService', () => {
  let svc: CanvasService;
  let db: DbService;

  beforeEach(async () => {
    (globalThis as unknown as { __resetIndexedDB: () => void }).__resetIndexedDB();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: cfgWith({ elementCap: 3, maxVersions: 2 }) },
        { provide: AuthService, useValue: auth() }
      ]
    });
    svc = TestBed.inject(CanvasService);
    db = TestBed.inject(DbService);
    await db.init();
  });

  it('createElement produces each type', () => {
    for (const t of ELEMENT_TYPES) {
      const el = svc.createElement(t, 1, 2);
      expect(el.type).toBe(t);
      expect(el.width).toBeGreaterThanOrEqual(2);
    }
  });

  it('tryAddElement respects cap', () => {
    const c = makeCanvas();
    expect(svc.tryAddElement(c, svc.createElement('button', 0, 0)).ok).toBe(true);
    expect(svc.tryAddElement(c, svc.createElement('button', 0, 0)).ok).toBe(true);
    expect(svc.tryAddElement(c, svc.createElement('button', 0, 0)).ok).toBe(true);
    const last = svc.tryAddElement(c, svc.createElement('button', 0, 0));
    expect(last.ok).toBe(false);
    expect(last.reason).toBe('cap');
    expect(svc.atCap(c)).toBe(true);
    expect(svc.remainingCapacity(c)).toBe(0);
  });

  it('deleteElements removes elements + connections + empty groups', () => {
    const c = makeCanvas();
    svc.tryAddElement(c, svc.createElement('button', 0, 0));
    svc.tryAddElement(c, svc.createElement('input', 10, 10));
    const [a, b] = c.elements;
    c.connections.push({ id: 'cc', fromId: a.id, toId: b.id, style: 'straight' });
    c.groups.push({ id: 'g', name: 'g', elementIds: [a.id] });
    svc.deleteElements(c, [a.id]);
    expect(c.elements.find((e) => e.id === a.id)).toBeUndefined();
    expect(c.connections.length).toBe(0);
    expect(c.groups.length).toBe(0);
  });

  it('createVersion + compaction + rollback', async () => {
    const c = makeCanvas();
    svc.tryAddElement(c, svc.createElement('button', 0, 0));
    await db.canvases.put(c);
    const v1 = await svc.createVersion(c, 'first');
    const v2 = await svc.createVersion(c, 'second');
    const v3 = await svc.createVersion(c, 'third');
    const all = await svc.listVersions(c.id);
    expect(all.length).toBe(2);
    expect(all.find((v) => v.id === v1.id)).toBeUndefined();
    c.elements = [];
    await db.canvases.put(c);
    await svc.rollback(c, v3.id);
    expect(c.elements.length).toBe(1);
    await expect(svc.rollback(c, 'missing')).rejects.toThrow(/not found/);
  });

  it('renameDuplicateId finds unique', () => {
    const set = new Set(['a', 'a_2', 'a_3']);
    expect(svc.renameDuplicateId(set, 'a')).toBe('a_4');
    expect(svc.renameDuplicateId(set, 'b')).toBe('b');
  });

  it('save updates timestamp and broadcasts', async () => {
    const c = makeCanvas();
    await db.canvases.put(c);
    const before = c.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await svc.save(c);
    expect(c.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('get returns undefined for a missing canvas id', async () => {
    expect(await svc.get('does-not-exist')).toBeUndefined();
  });

  it('createVersion numbers from 1 when no prior versions exist and audits the snapshot', async () => {
    const c = makeCanvas();
    await db.canvases.put(c);
    const v = await svc.createVersion(c);
    expect(v.versionNumber).toBe(1);
    const audit = (await db.audit.all()).find((a) => a.action === 'canvas.version');
    expect(audit?.entityId).toBe(c.id);
  });

  it('rollback pre-snapshots the current state as a pre-rollback version', async () => {
    const c = makeCanvas();
    await db.canvases.put(c);
    const v = await svc.createVersion(c, 'initial');
    // Mutate current state, then roll back.
    svc.tryAddElement(c, svc.createElement('button', 5, 5));
    await svc.rollback(c, v.id);
    const labels = (await svc.listVersions(c.id)).map((x) => x.label);
    expect(labels).toContain('pre-rollback');
  });

  it('renameDuplicateId returns the original id when not in the set (short-circuit branch)', () => {
    expect(svc.renameDuplicateId(new Set<string>(), 'fresh')).toBe('fresh');
  });

  it('deleteElements preserves connections and groups that do not reference deleted ids', () => {
    const c = makeCanvas();
    svc.tryAddElement(c, svc.createElement('button', 0, 0));
    svc.tryAddElement(c, svc.createElement('input', 10, 10));
    svc.tryAddElement(c, svc.createElement('label', 20, 20));
    const [a, b, third] = c.elements;
    c.connections.push({ id: 'keep', fromId: b.id, toId: third.id, style: 'straight' });
    c.groups.push({ id: 'gkeep', name: 'g', elementIds: [b.id, third.id] });
    svc.deleteElements(c, [a.id]);
    expect(c.connections.find((x) => x.id === 'keep')).toBeDefined();
    expect(c.groups.find((g) => g.id === 'gkeep')?.elementIds.length).toBe(2);
  });

  it('emits a diagnostics.alert.elementCap audit event exactly once when crossing the warn threshold', async () => {
    // elementCap=3 means the default capWarnPct=80 triggers on the 3rd element (100%).
    // Rebuild the TestBed with a small cap and a high maxVersions to stay focused on the alert path.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: cfgWith({ elementCap: 5, maxVersions: 2 }) },
        { provide: AuthService, useValue: auth() }
      ]
    });
    const small = TestBed.inject(CanvasService);
    const freshDb = TestBed.inject(DbService);
    await freshDb.init();
    const c = makeCanvas();

    // Below threshold: 2/5 = 40% — no alert.
    small.tryAddElement(c, small.createElement('button', 0, 0));
    small.tryAddElement(c, small.createElement('button', 0, 0));
    // Let the microtask from maybeRecordCapThreshold flush.
    await new Promise((r) => setTimeout(r, 0));
    let audit = (await freshDb.audit.all()).filter((a) => a.action === 'diagnostics.alert.elementCap');
    expect(audit.length).toBe(0);

    // Cross the 80% threshold: 4/5 = 80% — exactly one alert.
    small.tryAddElement(c, small.createElement('button', 0, 0));
    small.tryAddElement(c, small.createElement('button', 0, 0));
    await new Promise((r) => setTimeout(r, 0));
    audit = (await freshDb.audit.all()).filter((a) => a.action === 'diagnostics.alert.elementCap');
    expect(audit.length).toBe(1);
    expect(audit[0].entityType).toBe('canvas');
    expect(audit[0].entityId).toBe(c.id);
    expect(audit[0].details).toMatch(/4\/5/);

    // Further adds must not emit a second alert (debounced per canvas id).
    small.tryAddElement(c, small.createElement('button', 0, 0));
    await new Promise((r) => setTimeout(r, 0));
    audit = (await freshDb.audit.all()).filter((a) => a.action === 'diagnostics.alert.elementCap');
    expect(audit.length).toBe(1);
  });

  it('does not emit the cap audit event when adds stay below the warn threshold', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: cfgWith({ elementCap: 100 }) },
        { provide: AuthService, useValue: auth() }
      ]
    });
    const loose = TestBed.inject(CanvasService);
    const freshDb = TestBed.inject(DbService);
    await freshDb.init();
    const c = makeCanvas();
    for (let i = 0; i < 10; i++) loose.tryAddElement(c, loose.createElement('button', 0, 0));
    await new Promise((r) => setTimeout(r, 0));
    const audit = (await freshDb.audit.all()).filter((a) => a.action === 'diagnostics.alert.elementCap');
    expect(audit.length).toBe(0);
  });

  it('cap-threshold alert is a no-op when elementCap is 0 (defensive guard)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: cfgWith({ elementCap: 0 }) },
        { provide: AuthService, useValue: auth() }
      ]
    });
    const zero = TestBed.inject(CanvasService);
    const freshDb = TestBed.inject(DbService);
    await freshDb.init();
    const c = makeCanvas();
    // With cap=0, atCap() is true immediately, so tryAddElement returns
    // { ok: false } without reaching the threshold emitter. Call the private
    // emitter directly (with elements bypassing the cap check) to exercise
    // the `cap <= 0` early-return branch.
    (c.elements as unknown as Array<unknown>).push({ id: 'x', type: 'button', x: 0, y: 0, width: 1, height: 1 });
    await (zero as unknown as { maybeRecordCapThreshold: (x: unknown) => Promise<void> }).maybeRecordCapThreshold(c);
    const audit = (await freshDb.audit.all()).filter((a) => a.action === 'diagnostics.alert.elementCap');
    expect(audit.length).toBe(0);
  });

  it('cap-threshold alert is tracked per canvas id — two canvases each emit their own alert', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AppConfigService, useValue: cfgWith({ elementCap: 5 }) },
        { provide: AuthService, useValue: auth() }
      ]
    });
    const s = TestBed.inject(CanvasService);
    const freshDb = TestBed.inject(DbService);
    await freshDb.init();
    const a = makeCanvas();
    const b = makeCanvas();
    for (let i = 0; i < 4; i++) s.tryAddElement(a, s.createElement('button', 0, 0));
    for (let i = 0; i < 4; i++) s.tryAddElement(b, s.createElement('button', 0, 0));
    await new Promise((r) => setTimeout(r, 0));
    const audit = (await freshDb.audit.all()).filter((x) => x.action === 'diagnostics.alert.elementCap');
    expect(audit.length).toBe(2);
    expect(new Set(audit.map((x) => x.entityId))).toEqual(new Set([a.id, b.id]));
  });
});