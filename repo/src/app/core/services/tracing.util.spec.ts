import '../../../test-setup';
import { __resetTracesForTest, recentTraces, trace } from './tracing.util';
import { LoggerService } from '../../logging/logger.service';

describe('tracing.util', () => {
  let logger: LoggerService;

  beforeEach(() => {
    __resetTracesForTest();
    logger = new LoggerService();
  });

  it('records a successful operation as non-slow when under threshold', async () => {
    const res = await trace(logger, 'test.fast', 1000, async () => 'ok');
    expect(res).toBe('ok');
    const traces = recentTraces();
    expect(traces.length).toBe(1);
    expect(traces[0].action).toBe('test.fast');
    expect(traces[0].slow).toBe(false);
  });

  it('marks operation as slow when duration exceeds threshold', async () => {
    await trace(logger, 'test.slow', 0, async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const traces = recentTraces();
    expect(traces[0].slow).toBe(true);
  });

  it('still records on thrown errors and rethrows', async () => {
    await expect(trace(logger, 'test.err', 1000, async () => {
      throw new Error('boom');
    })).rejects.toThrow(/boom/);
    const traces = recentTraces();
    expect(traces.length).toBe(1);
    expect(traces[0].action).toBe('test.err');
    expect(traces[0].detail).toMatch(/boom/);
  });

  it('caps the ring buffer at 100 entries', async () => {
    for (let i = 0; i < 105; i++) {
      await trace(logger, `t.${i}`, 1000, async () => i);
    }
    const traces = recentTraces();
    expect(traces.length).toBe(100);
    // Oldest 5 should have been shifted out.
    expect(traces[0].action).toBe('t.5');
    expect(traces[traces.length - 1].action).toBe('t.104');
  });
});
