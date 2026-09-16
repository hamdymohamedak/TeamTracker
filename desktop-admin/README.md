# TeamTracker Admin (desktop)

Electron shell around the **admin web dashboard**.

- Opens the dashboard in-app
- **Open Website in Browser** from the app menu or tray
- Change dashboard URL (localhost presets, or set `TEAMTRACKER_ADMIN_URL`)

## Dev

```bash
cd desktop-admin
npm install
TEAMTRACKER_ADMIN_URL=http://localhost:3001 npm run dev
```

## Package

```bash
# Unsigned by default (no paid certificates required)
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist:mac    # or dist:win / dist:linux
```

CI builds this alongside the employee tracker on version tags (`v*`) or
manual workflow dispatch (`.github/workflows/build-desktop.yml`). Signing
secrets are optional — see [docs/DESKTOP_SIGNING.md](../docs/DESKTOP_SIGNING.md).
