import '../../src/test-setup';

/**
 * Direct-execution worker-module tests. The older `worker-contracts.spec.ts`
 * only exercised the pure helpers the workers delegate to — it never
 * imported `src/app/workers/*.ts`, so those four modules had zero coverage
 * and a regression in a worker's own top-level listener (wrong `type` guard,
 * missing `postMessage` call, etc.) would not surface in unit tests.
 *
 * This file imports each worker module under `jest.isolateModules` with the
 * global `addEventListener` / `postMessage` hooked, so we can capture the
 * message-handler the worker registers at import time and drive it with
 * synthetic events.
 */

type Posted = Record<string, unknown>;

interface Harness {
  fire: (data: unknown) => unknown | Promise<unknown>;
  posts: Posted[];
  restore: () => void;
}

function loadWorker(loader: () => void): Harness {
  const posts: Posted[] = [];
  let captured: ((ev: MessageEvent) => unknown) | null = null;
  const g = globalThis as unknown as {
    addEventListener: typeof addEventListener;
    postMessage: unknown;
  };
  const origAdd = g.addEventListener.bind(globalThis);
  const origPost = g.postMessage;

  g.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
    if (type === 'message') {
      captured = listener as (ev: MessageEvent) => unknown;
      return;
    }
    origAdd(type as keyof WindowEventMap, listener as EventListener, options);
  }) as typeof addEventListener;
  g.postMessage = (msg: Posted) => { posts.push(msg); };

  jest.isolateModules(() => {
    loader();
  });

  // Restore addEventListener now the module finished evaluating. Keep the
  // postMessage override in place — the captured handler will call it when
  // we invoke fire().
  g.addEventListener = origAdd as typeof addEventListener;

  const fire = (data: unknown): unknown | Promise<unknown> => {
    if (!captured) throw new Error('worker did not register a message handler');
    return captured({ data } as MessageEvent);
  };
  const restore = (): void => { g.postMessage = origPost; };
  return { fire, posts, restore };
}

describe('import.worker (direct module execution)', () => {
  let h: Harness;
  beforeEach(() => {
    h = loadWorker(() => { require('../../src/app/workers/import.worker'); });
  });
  afterEach(() => h.restore());

  it('registers a message listener at module load', () => {
    // If loadWorker didn't capture a listener it would have thrown on fire().
    // Sanity: triggering with a recognised message yields a response.
    h.fire({ type: 'IMPORT', payload: { raw: '[]', format: 'json', existingIds: [], maxNodes: 100, remainingCap: 100 } });
    expect(h.posts.length).toBe(1);
  });

  it('responds to IMPORT with IMPORT_RESULT whose body carries imported/skipped/renamed arrays', () => {
    const rows = [
      { id: 'a', type: 'button', x: 0, y: 0 },
      { id: 'a', type: 'button', x: 10, y: 10 }
    ];
    h.fire({
      type: 'IMPORT',
      payload: { raw: JSON.stringify(rows), format: 'json', existingIds: [], maxNodes: 100, remainingCap: 100 }
    });
    expect(h.posts).toHaveLength(1);
    const msg = h.posts[0] as { type: string; imported: unknown[]; skipped: unknown[]; renamed: unknown[]; total: number };
    expect(msg.type).toBe('IMPORT_RESULT');
    expect(Array.isArray(msg.imported)).toBe(true);
    expect(Array.isArray(msg.skipped)).toBe(true);
    expect(Array.isArray(msg.renamed)).toBe(true);
    expect(typeof msg.total).toBe('number');
    // Duplicate id in input surfaces as a rename entry, not a silent drop.
    expect(msg.renamed.length).toBe(1);
  });

  it('ignores messages whose `type` is not IMPORT (no postMessage)', () => {
    h.fire({ type: 'NOT_IMPORT', payload: {} });
    h.fire({});
    expect(h.posts).toEqual([]);
  });
});

describe('export-svg.worker (direct module execution)', () => {
  let h: Harness;
  beforeEach(() => {
    h = loadWorker(() => { require('../../src/app/workers/export-svg.worker'); });
  });
  afterEach(() => h.restore());

  it('responds to EXPORT_SVG with SVG_STRING containing a valid SVG document', () => {
    h.fire({
      type: 'EXPORT_SVG',
      payload: {
        elements: [{ id: 'b', type: 'button', x: 0, y: 0, width: 40, height: 20, text: 'go' }],
        connections: [],
        blobMap: {}
      }
    });
    expect(h.posts).toHaveLength(1);
    const msg = h.posts[0] as { type: string; svg: string };
    expect(msg.type).toBe('SVG_STRING');
    expect(msg.svg).toContain('<svg');
    expect(msg.svg).toContain('</svg>');
  });

  it('embeds a blob data URL in the SVG output when an image element references one', () => {
    h.fire({
      type: 'EXPORT_SVG',
      payload: {
        elements: [{ id: 'i', type: 'image', x: 0, y: 0, width: 40, height: 40, imageRef: 'k' }],
        connections: [],
        blobMap: { k: 'data:image/png;base64,abc' }
      }
    });
    const msg = h.posts[0] as { svg: string };
    expect(msg.svg).toContain('data:image/png;base64,abc');
  });

  it('ignores messages whose `type` is not EXPORT_SVG', () => {
    h.fire({ type: 'NOT_EXPORT', payload: {} });
    expect(h.posts).toEqual([]);
  });
});

describe('version-compact.worker (direct module execution)', () => {
  let h: Harness;
  beforeEach(() => {
    h = loadWorker(() => { require('../../src/app/workers/version-compact.worker'); });
  });
  afterEach(() => h.restore());

  it('responds to COMPACT with a COMPACT_PLAN of oldest-first deletion ids', () => {
    h.fire({
      type: 'COMPACT',
      payload: {
        versions: [
          { id: 'v4', versionNumber: 4 },
          { id: 'v1', versionNumber: 1 },
          { id: 'v3', versionNumber: 3 },
          { id: 'v2', versionNumber: 2 }
        ],
        // maxVersions: 2 with 4 inputs → worker compacts down to < cap,
        // i.e. keeps 1 version, emits three deletion ids oldest-first.
        maxVersions: 2
      }
    });
    expect(h.posts).toHaveLength(1);
    const msg = h.posts[0] as { type: string; deletions: string[] };
    expect(msg.type).toBe('COMPACT_PLAN');
    expect(msg.deletions).toEqual(['v1', 'v2', 'v3']);
  });

  it('emits an empty deletions list when the input is already well under cap', () => {
    h.fire({
      type: 'COMPACT',
      payload: {
        versions: [{ id: 'v1', versionNumber: 1 }],
        maxVersions: 5
      }
    });
    expect((h.posts[0] as { deletions: string[] }).deletions).toEqual([]);
  });

  it('ignores non-COMPACT messages', () => {
    h.fire({ type: 'OTHER', payload: {} });
    expect(h.posts).toEqual([]);
  });
});

describe('export-png.worker (direct module execution)', () => {
  let h: Harness;

  afterEach(() => h?.restore());

  it('posts PNG_ERROR when OffscreenCanvas is unavailable (JSDOM default environment)', async () => {
    // JSDOM does not provide OffscreenCanvas, so the guard in the worker
    // should short-circuit with a PNG_ERROR body.
    expect((globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas).toBeUndefined();
    h = loadWorker(() => { require('../../src/app/workers/export-png.worker'); });
    await h.fire({ type: 'EXPORT_PNG', payload: { svg: '<svg/>', width: 10, height: 10 } });
    expect(h.posts).toHaveLength(1);
    const msg = h.posts[0] as { type: string; error: string };
    expect(msg.type).toBe('PNG_ERROR');
    expect(msg.error).toContain('OffscreenCanvas');
  });

  it('catches unexpected runtime errors and posts PNG_ERROR (does not throw)', async () => {
    // Provide just enough of the OffscreenCanvas API surface for the guard
    // to pass, then force `createImageBitmap` to reject. The handler's catch
    // block must convert the rejection into a PNG_ERROR post.
    const g = globalThis as unknown as { OffscreenCanvas?: unknown; createImageBitmap?: unknown };
    const origOC = g.OffscreenCanvas;
    const origCIB = g.createImageBitmap;
    g.OffscreenCanvas = class {} as unknown as typeof OffscreenCanvas;
    g.createImageBitmap = () => Promise.reject(new Error('boom-from-test'));
    try {
      h = loadWorker(() => { require('../../src/app/workers/export-png.worker'); });
      await h.fire({ type: 'EXPORT_PNG', payload: { svg: '<svg/>' } });
      expect(h.posts).toHaveLength(1);
      const msg = h.posts[0] as { type: string; error: string };
      expect(msg.type).toBe('PNG_ERROR');
      expect(msg.error).toContain('boom-from-test');
    } finally {
      if (origOC === undefined) delete (g as { OffscreenCanvas?: unknown }).OffscreenCanvas; else g.OffscreenCanvas = origOC;
      if (origCIB === undefined) delete (g as { createImageBitmap?: unknown }).createImageBitmap; else g.createImageBitmap = origCIB;
    }
  });

  it('ignores non-EXPORT_PNG messages (no postMessage)', async () => {
    h = loadWorker(() => { require('../../src/app/workers/export-png.worker'); });
    await h.fire({ type: 'NOT_PNG', payload: {} });
    expect(h.posts).toEqual([]);
  });
});
