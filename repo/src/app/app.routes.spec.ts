import '../test-setup';
import { routes } from './app.routes';

describe('app.routes', () => {
  it('exposes a route table with the expected feature paths + a wildcard redirect', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining(['', 'login', 'projects', 'admin', 'reviews', 'diagnostics', 'backup', '**']));
  });

  it('root path redirects to /projects', () => {
    const root = routes.find((r) => r.path === '');
    expect(root?.redirectTo).toBe('projects');
    expect(root?.pathMatch).toBe('full');
  });

  it('wildcard path redirects to /projects', () => {
    const wild = routes.find((r) => r.path === '**');
    expect(wild?.redirectTo).toBe('projects');
  });

  it('every feature route is guarded by the authGuard', () => {
    const guardedPaths = ['projects', 'projects/:projectId/canvas/:canvasId', 'admin', 'reviews', 'diagnostics', 'backup'];
    for (const p of guardedPaths) {
      const r = routes.find((x) => x.path === p);
      expect(r).toBeDefined();
      expect(r!.canActivate?.length).toBe(1);
    }
  });

  it('each feature route exposes a loadComponent function for lazy loading', () => {
    const paths = ['login', 'projects', 'admin', 'reviews', 'diagnostics', 'backup'];
    for (const p of paths) {
      const r = routes.find((x) => x.path === p);
      expect(typeof r?.loadComponent).toBe('function');
    }
  });

  it('loadComponent factories resolve to component constructors', async () => {
    // Invoking each loadComponent exercises both the factory arrow and its
    // .then callback — closes the function-coverage gap on the route table.
    // The canvas editor route is skipped because its module uses
    // `new Worker(new URL(..., import.meta.url))`, which ts-jest cannot
    // transform under CommonJS coverage instrumentation.
    const lazyPaths = ['login', 'projects', 'admin', 'reviews', 'diagnostics', 'backup'];
    for (const p of lazyPaths) {
      const r = routes.find((x) => x.path === p);
      const mod = await r!.loadComponent!();
      expect(typeof mod).toBe('function');
    }
  });
});
