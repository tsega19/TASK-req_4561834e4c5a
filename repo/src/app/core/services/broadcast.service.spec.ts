import '../../../test-setup';
import { BroadcastService, CanvasSavedMessage } from './broadcast.service';

describe('BroadcastService', () => {
  it('watch + publish + dismiss', () => {
    const bc = new BroadcastService();
    bc.watch('c1');
    expect(bc.conflict()).toBeNull();
    bc.publishSave('c1');
    expect(() => bc.dismissConflict()).not.toThrow();
    bc.watch(null);
    expect(bc.conflict()).toBeNull();
  });

  it('subscribers receive messages via onmessage handler', () => {
    const bc = new BroadcastService();
    const received: CanvasSavedMessage[] = [];
    const unsub = bc.subscribe((m) => received.push(m));
    const ch = (bc as unknown as { channel: { onmessage: ((ev: MessageEvent) => void) | null } }).channel;
    if (ch && typeof ch.onmessage === 'function') {
      ch.onmessage(new MessageEvent('message', { data: { type: 'canvas-saved', canvasId: 'c', timestamp: 1, tabId: 'other' } }));
      expect(received.length).toBe(1);
    }
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('sets conflict when matching canvas message arrives from another tab', () => {
    const bc = new BroadcastService();
    bc.watch('c42');
    const ch = (bc as unknown as { channel: { onmessage: ((ev: MessageEvent) => void) | null } }).channel;
    if (ch && typeof ch.onmessage === 'function') {
      const ev = new MessageEvent('message', { data: { type: 'canvas-saved', canvasId: 'c42', timestamp: 1, tabId: 'other' } });
      ch.onmessage(ev);
      expect(bc.conflict()?.canvasId).toBe('c42');
    }
  });

  it('ignores its own tab messages', () => {
    const bc = new BroadcastService();
    bc.watch('c');
    const ch = (bc as unknown as { channel: { onmessage: ((ev: MessageEvent) => void) | null } }).channel;
    if (ch && typeof ch.onmessage === 'function') {
      const ev = new MessageEvent('message', { data: { type: 'canvas-saved', canvasId: 'c', timestamp: 1, tabId: bc.tabId } });
      ch.onmessage(ev);
      expect(bc.conflict()).toBeNull();
    }
  });

  it('ignores messages with missing data or wrong type (defensive parse)', () => {
    const bc = new BroadcastService();
    bc.watch('c');
    const ch = (bc as unknown as { channel: { onmessage: ((ev: MessageEvent) => void) | null } }).channel;
    const seen: unknown[] = [];
    bc.subscribe((m) => seen.push(m));
    if (ch && typeof ch.onmessage === 'function') {
      ch.onmessage(new MessageEvent('message', { data: undefined }));
      ch.onmessage(new MessageEvent('message', { data: { type: 'something-else', canvasId: 'c', timestamp: 1, tabId: 'x' } }));
    }
    expect(seen.length).toBe(0);
    expect(bc.conflict()).toBeNull();
  });

  it('publishSave swallows a closed-channel postMessage error', () => {
    const bc = new BroadcastService();
    const ch = (bc as unknown as { channel: BroadcastChannel }).channel;
    // Force postMessage to throw — the catch block must absorb it silently.
    (ch as unknown as { postMessage: () => never }).postMessage = () => { throw new Error('closed'); };
    expect(() => bc.publishSave('c1')).not.toThrow();
  });

  it('publishSave is a no-op when BroadcastChannel is not available', () => {
    const bc = new BroadcastService();
    // Null out the channel to exercise the `if (!this.channel) return;` early-exit.
    (bc as unknown as { channel: BroadcastChannel | null }).channel = null;
    const origBC = globalThis.BroadcastChannel;
    (globalThis as unknown as { BroadcastChannel: undefined }).BroadcastChannel = undefined as unknown as undefined;
    expect(() => bc.publishSave('c1')).not.toThrow();
    (globalThis as unknown as { BroadcastChannel: typeof origBC }).BroadcastChannel = origBC;
  });

  it('watch(null) clears any existing conflict', () => {
    const bc = new BroadcastService();
    bc.watch('cZ');
    const ch = (bc as unknown as { channel: { onmessage: ((ev: MessageEvent) => void) | null } }).channel;
    ch.onmessage!(new MessageEvent('message', { data: { type: 'canvas-saved', canvasId: 'cZ', timestamp: 1, tabId: 'o' } }));
    expect(bc.conflict()).not.toBeNull();
    bc.watch(null);
    expect(bc.conflict()).toBeNull();
  });
});