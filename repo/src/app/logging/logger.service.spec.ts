import '../../test-setup';
import { LoggerService, redact } from './logger.service';

describe('LoggerService', () => {
  it('redact masks sensitive keys recursively', () => {
    const out = redact({
      username: 'alice',
      password: 'secret',
      nested: { token: 'abc', list: [{ apikey: 'k', ok: true }] }
    }) as Record<string, unknown>;
    expect(out['username']).toBe('alice');
    expect(out['password']).toBe('***');
    expect((out['nested'] as Record<string, unknown>)['token']).toBe('***');
    const list = (out['nested'] as { list: Array<Record<string, unknown>> }).list;
    expect(list[0]['apikey']).toBe('***');
    expect(list[0]['ok']).toBe(true);
  });

  it('redact handles primitives and nulls', () => {
    expect(redact(null)).toBeNull();
    expect(redact(42)).toBe(42);
    expect(redact('hi')).toBe('hi');
    expect(redact(undefined)).toBeUndefined();
  });

  it('redact truncates deep cycles', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a['self'] = a;
    const out = redact(a, 7);
    expect(out).toBe('[truncated]');
  });

  it('emits into buffer and invokes sink', () => {
    const logger = new LoggerService();
    const seen: unknown[] = [];
    logger.setSink((e) => seen.push(e));
    logger.info('core', 'test', 'hello', { password: 'p' });
    logger.debug('core', 'test', 'd');
    logger.warn('core', 'test', 'w');
    const recent = logger.recent();
    expect(recent.length).toBe(3);
    expect(recent[0].level).toBe('info');
    const data = recent[0].data as Record<string, unknown>;
    expect(data['password']).toBe('***');
    expect(seen.length).toBe(3);
  });

  it('error level does not throw when sink fails', () => {
    const logger = new LoggerService();
    logger.setSink(() => { throw new Error('boom'); });
    expect(() => logger.error('m', 's', 'bad')).not.toThrow();
  });

  it('caps buffer', () => {
    const logger = new LoggerService();
    for (let i = 0; i < 600; i++) logger.debug('m', 's', `msg-${i}`);
    expect(logger.recent().length).toBe(500);
  });

  it('redact stringifies non-plain-object, non-array values (symbols, functions)', () => {
    // Functions and symbols fall through to the `return String(input)` branch.
    const fnResult = redact(() => 123);
    const symResult = redact(Symbol('s'));
    expect(typeof fnResult).toBe('string');
    expect(typeof symResult).toBe('string');
    expect(String(symResult)).toMatch(/Symbol/);
  });

  it('error level invokes console.error even when the sink is the default no-op', () => {
    const logger = new LoggerService();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => { /* no-op */ });
    logger.error('m', 's', 'serious');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});