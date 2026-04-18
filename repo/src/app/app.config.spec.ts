import '../test-setup';
import { appConfig } from './app.config';

describe('appConfig', () => {
  it('exposes a provider array', () => {
    expect(Array.isArray(appConfig.providers)).toBe(true);
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });
});
