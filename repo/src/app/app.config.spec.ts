import '../test-setup';
import { appConfig, initializeApp } from './app.config';
import { AuthService } from './core/services/auth.service';
import { DbService } from './core/services/db.service';
import { LoggerService } from './logging/logger.service';

describe('appConfig', () => {
  it('exposes a provider array', () => {
    expect(Array.isArray(appConfig.providers)).toBe(true);
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });
});

describe('initializeApp', () => {
  const makeDeps = (initError?: Error) => {
    const db = { init: jest.fn(async () => { if (initError) throw initError; }) } as unknown as DbService;
    const auth = {
      bootstrapSeed: jest.fn(async () => undefined),
      restoreSession: jest.fn()
    } as unknown as AuthService;
    const logger = { error: jest.fn() } as unknown as LoggerService;
    return { db, auth, logger };
  };

  it('boots the db, seeds users and restores the session before the router runs', async () => {
    const { db, auth, logger } = makeDeps();
    await initializeApp(db, auth, logger)();
    expect(db.init).toHaveBeenCalled();
    expect(auth.bootstrapSeed).toHaveBeenCalled();
    expect(auth.restoreSession).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('swallows boot errors so app bootstrap still completes', async () => {
    const { db, auth, logger } = makeDeps(new Error('idb boom'));
    await expect(initializeApp(db, auth, logger)()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
