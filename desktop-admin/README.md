# TeamTracker Admin (desktop)

Electron app for managers. When packaged, it **embeds the TeamTracker server** so you can run a local office without cloning the repo or installing Node.

- Starts a local admin server on `http://127.0.0.1:3001` (data under app userData)
- Advertises the office on the LAN via mDNS so employee apps can pick it by name
- Can still point at a remote/cloud dashboard via **Change Dashboard Mode…**

## Dev (shell only — use a separately running admin server)

```bash
cd desktop-admin
pnpm install
TEAMTRACKER_EMBED_SERVER=0 TEAMTRACKER_ADMIN_URL=http://localhost:3001 pnpm run dev
```

## Dev with embedded local server

```bash
# From repo root: build admin + bundle into desktop-admin/server-bundle
cd desktop-admin
pnpm run dev:local
```

## Package

```bash
# From desktop-admin (bundles admin server first)
export CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm run dist:mac    # or dist:win / dist:linux
```

CI builds this alongside the employee tracker on version tags (`v*`) or
manual workflow dispatch (`.github/workflows/build-desktop.yml`). Signing
secrets are optional — see [docs/DESKTOP_SIGNING.md](../docs/DESKTOP_SIGNING.md).

## Env

| Variable | Meaning |
|----------|---------|
| `TEAMTRACKER_EMBED_SERVER=1` | Force embed local server (even unpackaged) |
| `TEAMTRACKER_EMBED_SERVER=0` | Never embed; load `TEAMTRACKER_ADMIN_URL` / stored URL |
| `TEAMTRACKER_ADMIN_URL` | Remote dashboard URL when not embedding |
| `TEAMTRACKER_LAN_DISCOVERY` | Passed through to the embedded server (`0` to disable mDNS) |
| `TEAMTRACKER_OFFICE_NAME` | Friendly office name for discovery |
