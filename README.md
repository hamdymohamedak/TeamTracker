# TeamTracker — Employee Time Tracking for Small Businesses

**Repo: [github.com/hamdymohamedak/TeamTracker](https://github.com/hamdymohamedak/TeamTracker)**

**Know where your team's time goes. Without the enterprise price tag.**

TeamTracker is an open-source employee tracking SaaS. See who's working, what they're working on, and where time gets wasted — all in real-time from any device.

> Replace `YOUR_DOMAIN` below with your VPS domain (e.g. `https://track.yourcompany.com`) after you deploy.

---

## What You Get

- **Real-time dashboard** — see who's online, what app they're using, productivity scores
- **AI assistant** — ask "Who was most productive today?" in plain English
- **Automatic tracking** — silent desktop app, no timesheets, no manual entry
- **Smart role detection** — auto-detects if someone is a developer, designer, manager, etc. and adjusts scoring (admins can override)
- **Business hours** — set per-employee working hours; activity outside hours is shown separately, not counted against productivity
- **Multi-currency** — pick from 15+ currencies for each employee's hourly rate (USD, EUR, GBP, INR, AED, and more)
- **Company branding** — upload your own logo to replace the TeamTracker wordmark in the sidebar
- **Multi-tenant** — multiple businesses on one server, completely isolated data
- **Mobile friendly** — check your dashboard from your phone

---

## Getting Started (2 minutes)

### 1. Sign Up

Go to **[YOUR_DOMAIN/signup](https://YOUR_DOMAIN/signup)**. Enter your company name, your name, email, and a password. You're in.

**Save your recovery codes** shown right after signup. They are the offline way to reset your password (no email service required). Each code works once.

### 2. Add Employees

Go to **Employees** > **+ Add Employee**. Add each team member with their name, email, and department.

### 3. Install the Desktop Tracker

For each employee, click the **Setup Token** button next to their name. This generates a one-time setup code.

#### Option A: Download the pre-built app (recommended for employees)

Download the latest DMG (Mac), EXE (Windows), or AppImage/`.deb` (Linux) from [GitHub Releases](https://github.com/hamdymohamedak/TeamTracker/releases).

**macOS:**
1. Open the `.dmg`, drag **TeamTracker** to Applications
2. Right-click → **Open** → **Open Anyway** (required once for unsigned apps)
3. macOS will prompt for **Screen Recording** and **Accessibility** — grant both
4. TeamTracker runs silently in the background (no Dock icon, no menu bar)

**Windows:**
1. Run the `.exe` installer, follow the wizard
2. TeamTracker starts automatically — no permission prompts needed
3. SmartScreen may show "Windows protected your PC" on first run — click **More info → Run anyway**

**Linux:**
1. Download the `.AppImage` (or `.deb` for Debian/Ubuntu) from [GitHub Releases](https://github.com/hamdymohamedak/TeamTracker/releases)
2. Make it executable and launch:
   ```bash
   chmod +x TeamTracker-*-x86_64.AppImage
   ./TeamTracker-*-x86_64.AppImage
   ```
3. Install a window-title backend (see [Linux](#linux) below) so activity isn't stuck on "Unknown"
4. Optional autostart + KeepAlive:
   ```bash
   cd TeamTracker/desktop
   ./install-autostart-linux.sh /path/to/TeamTracker-*-x86_64.AppImage
   # or with stealth (no tray):
   ./install-autostart-linux.sh --stealth /path/to/TeamTracker-*-x86_64.AppImage
   ```

Enroll the tracker with the setup token from the dashboard:
```bash
# Get the device token (replace SETUP_TOKEN with the code from the dashboard)
curl -X POST https://YOUR_DOMAIN/api/auth/enroll \
  -H "Content-Type: application/json" \
  -d '{"setupToken":"PASTE_SETUP_TOKEN_HERE"}'
```

Save the returned `accessToken` to the config file:
```bash
# macOS
mkdir -p ~/Library/Application\ Support/@teamtracker/desktop
echo '{"deviceToken":"PASTE_ACCESS_TOKEN_HERE","serverUrl":"https://YOUR_DOMAIN"}' > ~/Library/Application\ Support/@teamtracker/desktop/config.json

# Linux (Electron userData for package name @teamtracker/desktop)
mkdir -p ~/.config/@teamtracker/desktop
echo '{"deviceToken":"PASTE_ACCESS_TOKEN_HERE","serverUrl":"https://YOUR_DOMAIN"}' > ~/.config/@teamtracker/desktop/config.json
```

TeamTracker auto-starts on login. To verify it's running, check the dashboard — you should see the employee appear within 60 seconds.

> See **[Desktop Tracker Permissions](#desktop-tracker-permissions)** below for details on what each OS needs.

#### Option B: Build from source (for developers)

If you want to build the tracker yourself or make changes:

```bash
git clone https://github.com/hamdymohamedak/TeamTracker.git
cd TeamTracker/desktop
npm install
```

**Run in dev mode:**
```bash
npx electron .
```

**Build a distributable app:**
```bash
npm run dist:mac    # builds DMG + ZIP for macOS (arm64 + x64)
npm run dist:win    # builds Windows installer (x64)
npm run dist:linux  # builds AppImage + .deb for Linux (x64)
npm run dist:all    # macOS + Windows + Linux
```

Build output goes to `desktop/release/`.

> **Note for monorepo builds:** the repo uses npm workspaces which can
> conflict with electron-builder's production install step. If the build
> fails, copy the `desktop/` folder to a standalone directory, run
> `npm install` there, then `npm run dist:mac`.

After building, re-sign the macOS app so Accessibility/Screen Recording permissions persist across restarts:
```bash
# Sign all nested frameworks, then the main app
find release/mac-arm64/TeamTracker.app/Contents/Frameworks -name "*.framework" -exec codesign --force --sign - {} \;
find release/mac-arm64/TeamTracker.app/Contents/Frameworks -name "*.app" -exec codesign --force --sign - {} \;
codesign --force --sign - --identifier com.teamtracker.tracker release/mac-arm64/TeamTracker.app
```

#### Auto-start on login

**macOS:** TeamTracker.app registers as a Login Item automatically. You can also add it manually: System Settings → General → Login Items → add TeamTracker.

**Windows:** The NSIS installer creates a Start Menu shortcut. To add auto-start, the installer places a Scheduled Task or you can add TeamTracker to Startup:
```powershell
cd TeamTracker\desktop
powershell -ExecutionPolicy Bypass -File install-autostart-windows.ps1
```

**Linux:** Use the XDG Autostart + systemd helper:
```bash
cd TeamTracker/desktop
./install-autostart-linux.sh /path/to/TeamTracker.AppImage
```

Symptoms that you're running an old tracker build: missing screenshots
(the screenshot capture loop was added in the 2026-04-06 batch), no
stealth mode, or browser tabs misclassified as social media.

### 4. Watch It Work

Go back to your dashboard at [YOUR_DOMAIN](https://YOUR_DOMAIN). Within a minute, you'll see employee activity — what apps they're using, productivity scores, time breakdowns. Check it from your phone too.

---

## Self-Hosting (Optional)

TeamTracker stays a **single-VPS** product: Node.js + SQLite + nginx + PM2. No PostgreSQL, Redis, or Kubernetes required.

Full production guide (data layout, env vars, HTTPS, backups, rollback): **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)**.

```bash
curl -sSL https://raw.githubusercontent.com/hamdymohamedak/TeamTracker/main/deploy.sh | bash
```

Works on DigitalOcean ($6/month droplet), AWS, or any VPS. Add a custom domain + HTTPS with:
```bash
certbot --nginx -d yourdomain.com
```

After deploy, confirm liveness and readiness:
- `GET /api/health` — process up
- `GET /api/ready` — database + storage usable

Related: [docs/BACKUP_RESTORE.md](./docs/BACKUP_RESTORE.md) · [docs/PRIVACY.md](./docs/PRIVACY.md) · [docs/DESKTOP_SIGNING.md](./docs/DESKTOP_SIGNING.md)

---

## Desktop Tracker Permissions

The tracker reads the active window's title and owning process. Different
operating systems gate this differently, so on the very first run each
employee will need to grant a small set of permissions.

### macOS (10.15 Catalina and newer)

macOS requires two permissions on first launch, both granted from
**System Settings → Privacy & Security**:

1. **Screen & System Audio Recording** — lets the tracker capture periodic
   screenshots. On first launch, macOS prompts automatically. Click
   **Open System Settings** and toggle on **TeamTracker**.
   - Settings path: **Privacy & Security → Screen & System Audio Recording
     → toggle on TeamTracker**.
2. **Accessibility** — lets the tracker read the active window title via
   the `active-win` library. Without this, activity shows as "Unknown".
   - Settings path: **Privacy & Security → Accessibility → toggle on
     TeamTracker**.

Both prompts appear once on first launch. The packaged app is signed with
a stable bundle ID (`com.teamtracker.tracker`), so permissions survive
restarts and app updates.

> ⚠️ **If you build from source**, re-sign the app after building (see
> "Build from source" above). Without re-signing, macOS may re-prompt for
> permissions on every restart because the code signature identifier
> defaults to "Electron".

### Windows (10 and newer)

Windows does not require an explicit permission for reading window titles —
the tracker uses standard user-level APIs (`GetForegroundWindow`). However,
you may see friction on first run:

1. **SmartScreen warning** — because the tracker binary isn't signed yet, the
   first launch may show "Windows protected your PC". Click **More info →
   Run anyway**. This only happens once per machine.
2. **Microsoft Defender / corporate AV** — some EDR products (CrowdStrike,
   SentinelOne, etc.) quarantine unsigned Electron apps by default. If the
   tracker exits immediately, add an exclusion for the TeamTracker folder or
   work with IT to whitelist the binary.
3. **Group Policy** — in locked-down enterprise environments, policy may
   block side-loaded Electron apps. You may need IT to push the tracker as
   an approved MSI.

No Accessibility or Screen Recording toggles are needed on Windows.

### Linux

The desktop tracker runs on Linux (x64) as an **AppImage** or **`.deb`**.
Window-title reading depends on the display server:

| Environment | Backend | What to install |
|-------------|---------|-----------------|
| **X11** (most classic desktops) | `active-win`, then `xdotool` / `xprop` | `sudo apt install xdotool` (recommended) |
| **GNOME Wayland** | Focused Window D-Bus extension via `gdbus` | [Focused Window D-Bus](https://extensions.gnome.org/extension/5592/focused-window-d-bus) |
| **Hyprland** | `hyprctl activewindow -j` | ships with Hyprland |
| **KDE Plasma (Wayland)** | `kdotool` | [kdotool](https://github.com/jinliu/kdotool) |

Without one of these backends, the tracker still runs and can upload
screenshots, but activity rows will show **"Unknown"** for the app/title.

**Screenshots on Wayland:** Electron uses the XDG Desktop Portal /
PipeWire screencast path. The first capture may show a system permission
dialog ("Allow TeamTracker to share your screen?") — grant it once per
session (or permanently, depending on the portal implementation).

**Autostart:** `desktop/install-autostart-linux.sh` writes an XDG
`.desktop` entry under `~/.config/autostart/` and, when available, a
`systemd --user` service with `Restart=on-failure`.

---

## Features

### Dashboard
- Team productivity score (0-100%)
- Focus time vs idle/wasted time
- Per-employee activity breakdown
- Suspicious activity alerts (YouTube while Slack shows "active", etc.)
- Time breakdown by category (Core Work, Communication, Research, etc.)

### AI Assistant (Genesis)
Ask questions in plain English:
- "Who was most productive today?"
- "How much time did Ahmed spend on emails?"
- "Who's at risk of burnout?"
- "Show me non-work activity this week"

### Smart Role Detection
The system watches what apps an employee uses and auto-detects their job type:
- **Developer** — VSCode, Terminal, Claude get scored as "Core Work"
- **Designer** — Figma, Photoshop, Sketch
- **Architect** — AutoCAD, Revit, SketchUp
- **Manager** — Jira, Zoom, Slack
- **Sales** — Salesforce, LinkedIn, CRM tools
- **Data Analyst** — Jupyter, Tableau, Excel

Admins can override it from **Employees → Edit Employee → Job Type**.

### Business Hours (per employee)
Each employee can have configured working hours (e.g. "Mon–Fri 09:00–17:30,
Asia/Kolkata"). Activity captured outside those hours is still stored — so
admins can audit it — but it is **not** counted in the employee's Total,
Productive, or Productivity Score. Instead it appears in a separate
"Outside Business Hours" card on the Report. Leave it unset (the default)
to track 24/7 — great for solopreneurs.

### Company Branding
Click the TeamTracker logo in the sidebar to open **Organization Settings**:
- Upload a custom company logo (PNG, JPEG, WebP, SVG, max 1 MB). It replaces
  the TeamTracker wordmark in the sidebar for everyone in the org. Leave it
  empty for the clean default.
- Set the organization's timezone (used for the "today" boundary on the
  Dashboard and as the default for new employees).
- Pick the default currency for new employees.

### Multi-Currency Hourly Rates
When adding or editing an employee, pick a currency from the dropdown next
to their hourly rate. Supported: USD, EUR, GBP, INR, CAD, AUD, JPY, AED,
SAR, SGD, BRL, MXN, ZAR, CHF, CNY. Reports and the Employees list format the
rate with the appropriate symbol.

### Daily Email Summary
Toggle on **Daily Email Summary** in Organization Settings, set a recipient
and an hour, and TeamTracker will email a per-employee productivity summary
once a day. The email contains:
- Team productivity score, total tracked time, productive time
- Per-employee score, total / productive / idle, top 5 apps with category
- Suspicious activity badges, "outside business hours" callouts when set

The summary is also viewable in the **Daily Summary** page in the dashboard
(useful for previewing what will go out, or sending a test on demand).

To wire SMTP, set these env vars on the server (PM2 / `pm2 ecosystem.config.cjs`
or your preferred process manager):

```bash
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass
SMTP_FROM="TeamTracker <noreply@yourdomain.com>"
```

If SMTP isn't configured, the cron still runs, the summary is still generated,
and the in-app preview still works. Only the actual mail send is gated.

### Periodic Screenshots
Toggle on **Periodic Screenshots** in Organization Settings, pick a capture
interval (1–60 min) and a retention window (1–365 days), and the desktop
tracker will quietly capture the primary display, JPEG-compress it, and
upload it to your dashboard. Browse them per-employee, per-day in the
**Screenshots** page (grid view + click for full-size lightbox + per-shot
delete). Old screenshots are auto-removed after the retention window.

Screenshots are off by default. Storage path on the server:
`admin/data/uploads/screenshots/<orgId>/<employeeId>/<YYYY-MM-DD>/<id>.jpg`.

### Stealth Mode (Desktop Tracker)
The tracker can run completely invisibly: no menu-bar / tray icon, no dock
icon on macOS, silent boot. Enable by launching with the `TEAMTRACKER_STEALTH=1`
env var:

```bash
TEAMTRACKER_STEALTH=1 npx electron .
```

Combined with a launch agent (macOS `launchd` plist), a Windows scheduled
task, or the Linux XDG/systemd autostart script, the tracker becomes
invisible to the employee while still uploading activity + screenshots to
the admin dashboard. Performance overhead is negligible — the tracker
checks the active window every 10 seconds and syncs every 60 seconds.

### Multi-Tenant
- Each business is completely isolated
- One server handles unlimited companies
- JWT auth for dashboard and desktop tracker
- Setup tokens for easy employee onboarding

---

## Architecture

```
[Employee Mac/PC/Linux]    [Your Server]              [Your Phone/Laptop]
  Desktop Tracker  --->  Node.js + SQLite  <---   Dashboard (any browser)
  (Electron app)         (port 3001)               (React SPA)
                         nginx (port 80)
```

- **Admin dashboard:** React SPA served by Express
- **API:** Express + SQLite on a **single VPS** (no Postgres/Redis/K8s required for production)
- **Persistent data:** `/var/lib/teamtracker` (DB, uploads, backups) — app code under `/opt/teamtracker/application`
- **Desktop tracker:** Electron app — samples the active window every **10
  seconds**, batches them, and syncs to the server every **60 seconds**.
- **Productivity math:** Dashboard and Reports share one formula —
  `score = productive ÷ (productive + unproductive) × 100`. "Other" /
  neutral and idle/break time are tracked separately and never dilute the
  score. The math always reconciles: every shown bucket sums to the total.
- **Timezones:** the dashboard's "today" window is computed in the admin's
  local timezone (sent with each request). Each organization also stores a
  default timezone, and each employee can override theirs.
- **Auth:** JWT tokens (24h dashboard, 90d device)
- **Process manager:** PM2 (auto-restart on crash)
- **Reverse proxy:** nginx (port 80 -> 3001, WebSocket support)

---

## Updating

Prefer the production-safe update script (does not wipe `/var/lib/teamtracker`):

```bash
bash /opt/teamtracker/application/deploy-enterprise.sh
```

Or see **[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** for manual update / rollback steps.

---

## API Reference

All endpoints require `Authorization: Bearer <token>` header (except auth endpoints).

### Auth
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/signup` | POST | Public | Create account + org (returns recovery codes once) |
| `/api/auth/login` | POST | Public | Login, get JWT |
| `/api/auth/reset-with-recovery-code` | POST | Public | Reset password with email + recovery code |
| `/api/auth/recovery-codes` | GET | Dashboard | Count unused recovery codes |
| `/api/auth/recovery-codes/regenerate` | POST | Dashboard | Issue new recovery codes (shown once) |
| `/api/auth/forgot-password` | POST | Public | Optional email reset link (only if SMTP/Resend configured) |
| `/api/auth/reset-password` | POST | Public | Reset password with email token |
| `/api/auth/team/:id/password` | POST | Owner/Admin | Set another teammate’s password |
| `/api/auth/setup-token` | POST | Dashboard | Generate employee setup token |
| `/api/auth/enroll` | POST | Public | Redeem setup token for device JWT |
| `/api/auth/me` | GET | Any | Get current user info |

### Password recovery (offline)

Forgot password in the UI uses a **recovery code** (no paid email required). From **Team** you can regenerate your codes while logged in, or set a teammate’s password.

Break-glass on the server (SSH / local machine with the SQLite DB):

```bash
pnpm run reset-password -- --email example@gmail.com --password '123456789' --codes
```

- `--email` / `--password` — required  
- `--codes` — also print fresh recovery codes once  
- Optional: `DATABASE_PATH=/var/lib/teamtracker/database/admin.db` if not using the default DB path  

### Employees & Activities
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/employees` | GET/POST | List or create employees (supports `currency`, `timezone`, `businessHoursStart`, `businessHoursEnd`, `businessHoursDays`) |
| `/api/employees/:id` | PUT/DELETE | Update or deactivate an employee |
| `/api/activities` | GET | Get tracked activities |
| `/api/activity` | POST | Desktop tracker syncs here |
| `/api/dashboard/stats?tz=<IANA>` | GET | Dashboard overview data for the admin's local day |
| `/api/reports/productivity?employeeId=&startDate=&endDate=&tz=` | GET | Productivity report (same tz-aware bounds + business-hours filter) |
| `/api/roles/:id` | GET/PUT | Smart role detection status / override (`roleType`: developer, designer, architect, manager, sales, data_analyst, writer, auto) |

### Organization settings (new)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/organization` | GET | Returns name, slug, timezone, logoUrl, defaultCurrency |
| `/api/organization` | PUT | Update name / timezone / defaultCurrency |
| `/api/organization/logo` | POST | Upload logo. Body: `{ mimeType, dataBase64 }`. Max 1 MB. PNG/JPEG/WebP/SVG. |
| `/api/organization/logo` | DELETE | Remove the current logo |

---

## System Requirements

**Server:** Ubuntu 20.04+, 1GB RAM, 1 CPU ($6/month on DigitalOcean)

**Desktop tracker:** Node.js 18+ on Mac, Windows, or Linux (x64). See
[Desktop Tracker Permissions](#desktop-tracker-permissions) for the
per-OS first-run setup. On Linux, install a window-title backend
(xdotool on X11, or a Wayland compositor bridge — see the Linux section).

**Dashboard:** Any modern browser (phone or computer)

---

## License

MIT License — free to use, modify, and sell.

Built for small business owners who deserve big tools.
