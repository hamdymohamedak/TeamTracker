# TeamTracker Developer Guide

This guide explains where code lives after the maintainability refactor, and how to add features safely.

## Package map

| Package | Role |
|---------|------|
| `admin/` | Express + SQLite API, WebSocket server, React admin dashboard (Vite) |
| `desktop/` | Electron employee tracker |
| `desktop-admin/` | Electron shell that loads the admin web UI |
| `shared/` | Framework-independent types, classification, live-view protocol |

Architecture (unchanged): Node.js + SQLite + Express + WebSocket + Electron + nginx/PM2 on a single VPS.

## Admin client (`admin/src/client/`)

```text
app/                 # Shell, routes, layout (thin App entry)
features/
  dashboard/         # Stats, getting-started, dashboard hooks
  live-view/         # Live View panel UI (controller stays in live-view/)
  employees/         # Employee list, forms, setup tokens
  screenshots/
  privacy/
  reports/
  projects/
  tasks/
  organizations/     # Team + org settings
  authentication/    # Login / signup / password flows
  ai/                # Genesis AI UI
  download/
components/          # Shared UI (PageHero, icons, etc.)
contexts/            # Auth, I18n, WebSocket
lib/                 # api client, shared client utils
live-view/           # LiveViewSessionController (protocol client logic)
styles/              # theme.css
i18n/
pages/               # Thin re-exports / composers for routes
```

**Path alias:** `@/*` → `src/client/*` (Vite + tsconfig).

### Adding a UI feature

1. Create `features/<name>/` with only the folders you need (`components/`, `hooks/`, `services/`, `types.ts`, `index.ts`).
2. Keep page route thin — compose feature components in `pages/` or `app/routes.tsx`.
3. Call APIs via `lib/api.ts`; do not put SQL or server secrets in the client.
4. Do not import another feature’s internal files — share via `lib/`, `contexts/`, or `shared/`.

## Admin server (`admin/server/`)

```text
index.ts             # Process bootstrap, listen, schedulers
app/create-app.ts    # Express app factory (also used by HTTP tests)
routes/              # Domain route modules (auth, employees, activity, …)
services/            # Business logic (e.g. activity-ingest)
repositories/        # SQLite CRUD / queries by domain
database/
  connection.ts      # open DB, schema seed, getDatabase
  index.ts           # public re-exports
websocket/           # Modular WS: auth, clients, live-view, sync, …
migrations.ts        # Schema migrations (keep separate from repos)
```

Compatibility shims:

- `database.ts` → re-exports `database/index.js`
- `websocket.ts` → re-exports `websocket/index.js`
- `routes.ts` → composer calling domain `setup*Routes`

### Layering

```text
Route → Service (optional) → Repository → SQLite
```

Routes should stay thin. Put classification / ingest rules in `services/`. Put SQL in `repositories/`.

### Adding an API

1. Add or extend a route file under `routes/`.
2. Add repository functions if you need new queries.
3. Register the route from the composer or from `index.ts` / `create-app.ts` (same mount order as production).
4. **Do not** change URL paths or response shapes unless intentional and documented.
5. Always filter by `org_id` / `req.orgId`.

## WebSocket

Modules under `admin/server/websocket/`. Public exports: `setupWebSocket`, `isEmployeeOnline`, `getConnectedEmployees`, `requestScreenshotCommand`, `broadcastScreenshotNew`.

**Do not change** message `type` strings or binary TLV framing (see `docs/live-view-webrtc.md`).

## Shared package (`shared/`)

- `src/classification.ts` — activity classification rules
- `src/live-view/` — quality, transport profiles, binary codec, state helpers

Canonical source is `shared/src/`. Admin and desktop consume it via **thin re-exports** of `shared/dist/` (avoids nested `workspace:*` installs and `rootDir` issues):

- `admin/shared/live-view/*` → `shared/dist/live-view/*`
- `desktop/src/live-view-shared/*` → `shared/dist/live-view/*`
- `desktop/src/classifier.ts` — imports shared classification; keeps desktop-specific thresholds/rules

Always run `pnpm run build:shared` (or rely on admin/desktop `predev` / `prebuild` / `pretest` hooks) so `shared/dist` exists and `scripts/write-live-view-stubs.mjs` **copies** compiled live-view files into `admin/shared/live-view/`, `desktop/src/live-view-shared/`, and (after `build:server`) `admin/dist/shared/live-view/`. Edit `shared/src/` then rebuild shared — no manual file copies. Production must use the copied files under `admin/dist/shared/` (relative re-exports into `shared/dist` break under `dist/`).

## Desktop (`desktop/src/`)

```text
main.ts              # Electron entry
tracker/             # Enrollment, offline queue, sync, capture loop, IPC
capture / screenshot / active-window
live-view / webrtc-*
privacy/
ui/                  # HTML shell
```

## Tests

Framework: Node.js built-in test runner via `tsx --test`.

```bash
pnpm test                 # admin + desktop
pnpm test:admin
pnpm test:desktop
pnpm typecheck
pnpm test-all             # typecheck + tests + all builds
```

Admin tests live in `admin/server/__tests__/`:

- Helpers: `__tests__/helpers/` (`ensureTestEnv`, `createOrgUser`, `mockReqRes`)
- Coverage: security, repository isolation, live-view pure logic, WebSocket integration, HTTP API (`createApp`)

When adding server behavior, prefer a focused `node:test` file using the helpers and `createApp` rather than only manual QA.

## Validation checklist

Before merging large refactors:

1. `pnpm install`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build:admin`
5. `pnpm build:desktop`
6. `pnpm build:desktop-admin`

CI (`.github/workflows/ci.yml`) runs typecheck (all packages), admin tests + build, and desktop tests.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md). Refactors must not change deploy topology, env var names, or data paths under `/var/lib/teamtracker`.
