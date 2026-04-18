import '../../../test-setup';
import { sha256Hex, sha256Js, uuid } from './crypto.util';

describe('crypto.util', () => {
  it('sha256Hex produces 64-char hex matching the known SHA-256 of "hello"', async () => {
    const h = await sha256Hex('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    const h2 = await sha256Hex('hello');
    expect(h).toBe(h2);
    const h3 = await sha256Hex('world');
    expect(h3).not.toBe(h);
  });

  it('sha256Hex falls back to JS when crypto.subtle.digest throws', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...original, subtle: { digest: () => Promise.reject(new Error('no subtle')) } },
      configurable: true,
      writable: true
    });
    const h = await sha256Hex('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true, writable: true });
  });

  it('sha256Js matches known vectors', () => {
    expect(sha256Js(new TextEncoder().encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Js(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('uuid returns unique v4-ish strings', () => {
    const a = uuid();
    const b = uuid();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uuid falls back to getRandomValues when crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto;
    // Keep getRandomValues but drop randomUUID so the fallback branch runs.
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (arr: Uint8Array) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 17) & 0xff; return arr; }
      },
      configurable: true,
      writable: true
    });
    const id = uuid();
    // RFC4122 v4: version nibble = 4, variant nibble in {8,9,a,b}
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true, writable: true });
  });

  it('uuid falls back to Math.random when getRandomValues is also unavailable', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true, writable: true });
  });

  it('sha256Hex falls back to JS when subtle.digest is missing entirely', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: original.getRandomValues?.bind(original) },
      configurable: true, writable: true
    });
    const h = await sha256Hex('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true, writable: true });
  });
});