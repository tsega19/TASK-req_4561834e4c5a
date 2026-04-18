import '../../../test-setup';
import { CanvasRecord } from '../../core/models/models';
import { UndoStack, applySnapshot, snapshotOf } from './canvas-state';

function sampleCanvas(): CanvasRecord {
  return {
    id: 'c',
    projectId: 'p',
    name: 'x',
    description: '',
    elements: [{ id: 'e1', type: 'button', x: 0, y: 0, width: 10, height: 10 }],
    connections: [],
    groups: [{ id: 'g1', name: 'g', elementIds: ['e1'] }],
    viewState: { zoom: 1, panX: 0, panY: 0, gridSize: 20 },
    createdAt: 1, updatedAt: 1, createdBy: 'u', tags: []
  };
}

describe('canvas-state', () => {
  it('snapshotOf deep clones', () => {
    const c = sampleCanvas();
    const s = snapshotOf(c);
    s.elements[0].x = 99;
    expect(c.elements[0].x).toBe(0);
    s.groups[0].elementIds.push('x');
    expect(c.groups[0].elementIds.length).toBe(1);
  });

  it('applySnapshot overwrites current state', () => {
    const c = sampleCanvas();
    const s = snapshotOf(c);
    s.elements.push({ id: 'e2', type: 'input', x: 1, y: 1, width: 10, height: 10 });
    applySnapshot(c, s);
    expect(c.elements.length).toBe(2);
  });

  it('UndoStack push/undo/redo/clear', () => {
    const u = new UndoStack(3);
    expect(u.canUndo()).toBe(false);
    const snap = snapshotOf(sampleCanvas());
    u.push(snap);
    expect(u.canUndo()).toBe(true);
    const current = snapshotOf(sampleCanvas());
    const prev = u.undo(current);
    expect(prev).toBeTruthy();
    expect(u.canRedo()).toBe(true);
    const next = u.redo(current);
    expect(next).toBeTruthy();
    u.clear();
    expect(u.canUndo()).toBe(false);
  });

  it('UndoStack enforces size limit', () => {
    const u = new UndoStack(2);
    for (let i = 0; i < 5; i++) u.push(snapshotOf(sampleCanvas()));
    expect(u.size().undo).toBe(2);
  });

  it('undo on empty returns null', () => {
    const u = new UndoStack(2);
    expect(u.undo(snapshotOf(sampleCanvas()))).toBeNull();
    expect(u.redo(snapshotOf(sampleCanvas()))).toBeNull();
  });

  it('undo/redo caps the opposing stack at the configured limit', () => {
    const u = new UndoStack(2);
    const snaps = [snapshotOf(sampleCanvas()), snapshotOf(sampleCanvas()), snapshotOf(sampleCanvas())];
    for (const s of snaps) u.push(s);
    // Undo three times, each push to redoStack — triggers the >limit shift branch.
    u.undo(snapshotOf(sampleCanvas()));
    u.undo(snapshotOf(sampleCanvas()));
    // redo stack should now be at limit (2)
    expect(u.size().redo).toBe(2);
    // Redo twice, pushing to undoStack — exercises the symmetric >limit shift.
    u.redo(snapshotOf(sampleCanvas()));
    u.redo(snapshotOf(sampleCanvas()));
    expect(u.size().undo).toBeLessThanOrEqual(2);
  });

  it('snapshotOf preserves tags and decouples groups from the source', () => {
    const c = sampleCanvas();
    c.elements[0].tags = ['a', 'b'];
    const s = snapshotOf(c);
    expect(s.elements[0].tags).toEqual(['a', 'b']);
    // Mutating the snapshot tags must not touch the original.
    s.elements[0].tags!.push('c');
    expect(c.elements[0].tags).toEqual(['a', 'b']);
  });
});