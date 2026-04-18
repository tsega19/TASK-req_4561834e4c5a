# FlowCanvas Offline Studio

Browser-native offline diagramming SPA (Angular 17). Zero backend, all data in IndexedDB.

## Quick start

Two supported paths — pick either.

### Option A: Local Node toolchain (Node 20+)

```bash
npm install
npm start       # runs `ng serve` on http://localhost:4200
```

Additional scripts: `npm run build`, `npm test` (Jest with coverage), `npm run test:e2e` (Playwright), `npm run lint` (typecheck).

### Option B: Docker 20+

```bash
docker-compose up --build
```

Both paths serve the app at http://localhost:4200.

### Seeded accounts (demo-only — change before any real use)

These are **deterrent-only** placeholder credentials for a local pseudo-login.
They are intentionally non-password-like (`demo-change-me-*`) so they cannot be
mistaken for a secure default. Override them via `docker-compose.yml` env vars
(`SEED_*_PASSPHRASE`) or the corresponding `window.__FC_ENV__` value before use.

| Role     | Username   | Passphrase (demo default)  |
|----------|------------|----------------------------|
| Admin    | admin      | demo-change-me-admin       |
| Editor   | editor     | demo-change-me-editor      |
| Reviewer | reviewer   | demo-change-me-reviewer    |

## Running tests inside Docker

```bash
./run_tests.sh
```

This builds a Playwright-ready image, runs Jest unit tests (coverage in `.tmp/coverage/`), boots the app container, then runs Playwright E2E against the running container. Summary is written to `.tmp/test-summary.txt`.

## Ports

| Container | Host port | Purpose |
|-----------|-----------|---------|
| flowcanvas (nginx) | 4200 → 80 | app |

## Architecture (short)

- Angular 17 standalone components + Signals
- `src/app/config/` — single source of truth for runtime config. Reads `window.__FC_ENV__` (populated by `docker-entrypoint.sh` from container env vars) with typed defaults.
- `src/app/logging/` — `LoggerService` with `[module][sub-module]` format and automatic redaction of passwords/tokens.
- `src/app/core/services/` — `DbService` (IndexedDB via `idb`), `AuthService` (SHA-256 WebCrypto, 3-strike cooldown, 30-min inactivity), `PermissionService` (capability matrix), `BroadcastService` (multi-tab), `NotificationService`, `AuditService`.
- `src/app/core/guards/` — `authGuard` protects routes (login required); roles are used only for UI filtering, not route enforcement.
- `src/app/features/` — `auth`, `projects`, `canvas`, `admin`, `reviewer`, `diagnostics`, `backup`.
- `src/app/workers/` — import, SVG export, version compaction.
- Service Worker for offline-first PWA.

See [`docs/design.md`](../docs/design.md) for full details. Additional docs: [`docs/api_aspec.md`](../docs/api_aspec.md), [`docs/questions.md`](../docs/questions.md).

## User-visible guarantees

- **Element cap:** canvases are hard-limited to 5,000 elements. Crossing 80% of the cap emits a one-shot diagnostics alert into the immutable audit timeline; attempting to exceed the cap surfaces a blocking modal.
- **Version history:** each canvas keeps the most recent 30 versions. Older snapshots are pruned automatically; any version in the list can be rolled back to, which first snapshots the current state as a `pre-rollback` version so the operation itself is reversible.
- **Autosave + conflict:** canvases autosave every 10s; if another tab saves the same canvas, a conflict banner appears with "Reload latest" / "Keep mine" options.

## Tech guard rails

- All env vars defined in `docker-compose.yml`; application logic reads through `AppConfigService` only (no direct `window.__FC_ENV__` reads in features).
- Roles are convenience-only filters. `PermissionService.can()` hides menu items, buttons, and screens for the user's role, but there is no hard enforcement on routes or in services (the app is local-only, single-user per browser, pseudo-login).
- Seeded credentials are **deterrent-only** and intended to be changed immediately in local deployments. Not a secure auth system.
- External services (Stripe/SES/Twilio) — not applicable; this app has no network calls.
- Structured logging `[module][sub-module] message` with redaction of `password`, `token`, `secret`, `apikey`, `ssn`.
- No `console.log`/`console.debug` in production code. Only `console.error` in the logger sink for unrecoverable errors.
