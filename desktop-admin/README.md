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
npm run dist:mac    # or dist:win / dist:linux
```

CI builds this alongside the employee tracker on every push to `main`.
