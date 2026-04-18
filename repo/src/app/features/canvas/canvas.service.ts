import { Injectable, inject } from '@angular/core';
import { DbService } from '../../core/services/db.service';
import { AppConfigService } from '../../config/app-config.service';
import { AuthService } from '../../core/services/auth.service';
import { PermissionService } from '../../core/services/permission.service';
import { LoggerService } from '../../logging/logger.service';
import { BroadcastService } from '../../core/services/broadcast.service';
import { AuditService } from '../../core/services/audit.service';
import { uuid } from '../../core/services/crypto.util';
import { trace } from '../../core/services/tracing.util';
import { CanvasRecord, VersionRecord, ElementType, CanvasElement } from '../../core/models/models';
import { snapshotOf } from './canvas-state';

export interface AddElementResult {
  ok: boolean;
  element?: CanvasElement;
  reason?: 'cap';
}

@Injectable({ providedIn: 'root' })
export class CanvasService {
  private readonly db = inject(DbService);
  private readonly cfg = inject(AppConfigService);
  private readonly auth = inject(AuthService);
  private readonly perm = inject(PermissionService);
  private readonly logger = inject(LoggerService);
  private readonly bc = inject(BroadcastService);
  private readonly audit = inject(AuditService);

  // Canvases that have already emitted a `diagnostics.alert.elementCap`
  // audit event in this session, keyed by canvas id. Debounces the alert
  // so fills that hover around the threshold do not spam the audit log.
  private readonly capAlerted = new Set<string>();

  async get(id: string): Promise<CanvasRecord | undefined> {
    return this.db.canvases.get(id);
  }

  async save(canvas: CanvasRecord): Promise<void> {
    this.perm.enforce('canvas.edit');
    canvas.updatedAt = Date.now();
    await this.db.canvases.put(canvas);
    this.bc.publishSave(canvas.id);
    this.logger.debug('canvas', 'save', 'persisted canvas', { id: canvas.id, elements: canvas.elements.length });
  }

  atCap(canvas: CanvasRecord): boolean {
    return canvas.elements.length >= this.cfg.get().canvas.elementCap;
  }

  remainingCapacity(canvas: CanvasRecord): number {
    return Math.max(0, this.cfg.get().canvas.elementCap - canvas.elements.length);
  }

  createElement(type: ElementType, x: number, y: number): CanvasElement {
    const base: CanvasElement = {
      id: uuid(),
      type,
      x,
      y,
      width: 140,
      height: 80,
      backgroundColor: '#1e293b',
      borderColor: '#38bdf8',
      borderWidth: 2,
      borderRadius: 4,
      textColor: '#e2e8f0',
      fontSize: 14,
      opacity: 1,
      locked: false,
      zIndex: 0
    };
    switch (type) {
      case 'text':
        return { ...base, text: 'Text', backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0 };
      case 'button':
        return { ...base, text: 'Button', backgroundColor: '#2563eb', borderColor: '#1d4ed8', textColor: '#f8fafc', borderRadius: 8, width: 120, height: 40 };
      case 'input':
        return { ...base, text: '', placeholder: 'Enter text…', backgroundColor: '#0f172a', borderColor: '#475569', textColor: '#e2e8f0', borderRadius: 4, width: 180, height: 36 };
      case 'image':
        return { ...base, text: '', backgroundColor: '#0f172a', width: 200, height: 160 };
      case 'container':
        return { ...base, text: 'Container', backgroundColor: 'transparent', borderColor: '#64748b', borderWidth: 2, borderRadius: 6, textColor: '#94a3b8', width: 260, height: 180 };
      case 'label':
        return { ...base, text: 'Label', backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, textColor: '#cbd5e1', width: 100, height: 24 };
      case 'flow-node':
        return { ...base, text: 'Flow node', shape: 'process' };
      case 'sticky-note':
        return { ...base, text: 'Note', backgroundColor: '#fde68a', textColor: '#0a1220', noteColor: '#fde68a', borderColor: '#f59e0b' };
      default:
        return { ...base, text: '' };
    }
  }

  tryAddElement(canvas: CanvasRecord, el: CanvasElement): AddElementResult {
    if (this.atCap(canvas)) {
      this.logger.warn('canvas', 'cap', 'element cap reached', { id: canvas.id });
      return { ok: false, reason: 'cap' };
    }
    const copy: CanvasElement = { ...el };
    copy.zIndex = (canvas.elements.reduce((m, e) => Math.max(m, e.zIndex ?? 0), 0)) + 1;
    canvas.elements.push(copy);
    void this.maybeRecordCapThreshold(canvas);
    return { ok: true, element: copy };
  }

  /**
   * Emit a `diagnostics.alert.elementCap` audit event the first time a canvas
   * crosses the configured `diagnostics.capWarnPct` threshold. Idempotent per
   * canvas-id within the current session — repeated hovering around the
   * threshold will not duplicate the event.
   */
  private async maybeRecordCapThreshold(canvas: CanvasRecord): Promise<void> {
    if (this.capAlerted.has(canvas.id)) return;
    const cap = this.cfg.get().canvas.elementCap;
    if (cap <= 0) return;
    const pct = (canvas.elements.length / cap) * 100;
    const warn = this.cfg.get().diagnostics.capWarnPct;
    if (pct < warn) return;
    this.capAlerted.add(canvas.id);
    this.logger.warn('canvas', 'cap-threshold', 'element cap threshold crossed', { id: canvas.id, pct, warn });
    await this.audit.record(
      this.auth.session(),
      'diagnostics.alert.elementCap',
      'canvas',
      canvas.id,
      `${canvas.elements.length}/${cap} (${pct.toFixed(1)}%)`
    );
  }

  deleteElements(canvas: CanvasRecord, ids: string[]): void {
    const set = new Set(ids);
    canvas.elements = canvas.elements.filter((e) => !set.has(e.id));
    canvas.connections = canvas.connections.filter((c) => !set.has(c.fromId) && !set.has(c.toId));
    canvas.groups = canvas.groups
      .map((g) => ({ ...g, elementIds: g.elementIds.filter((id) => !set.has(id)) }))
      .filter((g) => g.elementIds.length > 0);
  }

  async createVersion(canvas: CanvasRecord, label?: string): Promise<VersionRecord> {
    const slowMs = this.cfg.get().diagnostics.slowMs;
    return trace(this.logger, 'canvas.createVersion', slowMs, async () => {
      const existing = (await this.db.versions.byCanvas(canvas.id)).sort((a, b) => a.versionNumber - b.versionNumber);
      const max = this.cfg.get().canvas.maxVersions;
      while (existing.length >= max) {
        const oldest = existing.shift();
        if (oldest) {
          await this.db.versions.delete(oldest.id);
          this.logger.debug('canvas', 'version-compact', 'pruned oldest version', { id: oldest.id });
        }
      }
      const number = (existing[existing.length - 1]?.versionNumber ?? 0) + 1;
      const rec: VersionRecord = {
        id: uuid(),
        canvasId: canvas.id,
        projectId: canvas.projectId,
        versionNumber: number,
        snapshotJson: JSON.stringify(snapshotOf(canvas)),
        createdAt: Date.now(),
        createdBy: this.auth.session()?.userId ?? 'anonymous',
        label
      };
      await this.db.versions.put(rec);
      this.logger.info('canvas', 'version', 'snapshot saved', { canvasId: canvas.id, versionNumber: number });
      await this.audit.record(this.auth.session(), 'canvas.version', 'canvas', canvas.id, `v${number}`);
      return rec;
    });
  }

  async listVersions(canvasId: string): Promise<VersionRecord[]> {
    const vs = await this.db.versions.byCanvas(canvasId);
    return vs.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async rollback(canvas: CanvasRecord, versionId: string): Promise<CanvasRecord> {
    this.perm.enforce('canvas.edit');
    const slowMs = this.cfg.get().diagnostics.slowMs;
    return trace(this.logger, 'canvas.rollback', slowMs, async () => {
      const vs = await this.db.versions.byCanvas(canvas.id);
      const target = vs.find((v) => v.id === versionId);
      if (!target) throw new Error('Version not found.');
      await this.createVersion(canvas, 'pre-rollback');
      const snap = JSON.parse(target.snapshotJson) as ReturnType<typeof snapshotOf>;
      canvas.elements = snap.elements;
      canvas.connections = snap.connections;
      canvas.groups = snap.groups;
      canvas.viewState = snap.viewState;
      canvas.updatedAt = Date.now();
      await this.db.canvases.put(canvas);
      await this.audit.record(this.auth.session(), 'canvas.rollback', 'canvas', canvas.id, `to v${target.versionNumber}`);
      return canvas;
    });
  }

  renameDuplicateId(existingIds: Set<string>, rawId: string): string {
    if (!existingIds.has(rawId)) return rawId;
    let n = 2;
    let candidate = `${rawId}_${n}`;
    while (existingIds.has(candidate)) {
      n++;
      candidate = `${rawId}_${n}`;
    }
    return candidate;
  }
}
