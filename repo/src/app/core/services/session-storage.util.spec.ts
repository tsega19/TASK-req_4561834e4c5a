import '../../../test-setup';
import { lsGet, lsGetJson, lsRemove, lsSet, lsSetJson, LS_KEYS } from './session-storage.util';

describe('session-storage.util', () => {
  beforeEach(() => localStorage.clear());

  it('set/get/remove', () => {
    lsSet('k', 'v');
    expect(lsGet('k')).toBe('v');
    lsRemove('k');
    expect(lsGet('k')).toBeNull();
  });

  it('json helpers', () => {
    lsSetJson('j', { a: 1 });
    expect(lsGetJson<{ a: number }>('j')).toEqual({ a: 1 });
    expect(lsGetJson('missing')).toBeNull();
  });

  it('json returns null on bad JSON', () => {
    lsSet('bad', '{not json');
    expect(lsGetJson('bad')).toBeNull();
  });

  it('exports stable keys', () => {
    expect(LS_KEYS.SESSION).toBe('fc_session');
    expect(LS_KEYS.LAST_PROJECT).toBe('fc_last_project');
  });

  it('lsGet returns null when localStorage.getItem throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('disabled'); };
    try {
      expect(lsGet('anything')).toBeNull();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('lsSet / lsRemove swallow storage exceptions', () => {
    const origSet = Storage.prototype.setItem;
    const origRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    Storage.prototype.removeItem = () => { throw new Error('quota'); };
    try {
      expect(() => lsSet('k', 'v')).not.toThrow();
      expect(() => lsRemove('k')).not.toThrow();
    } finally {
      Storage.prototype.setItem = origSet;
      Storage.prototype.removeItem = origRemove;
    }
  });
});