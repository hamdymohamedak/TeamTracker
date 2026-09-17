# TeamTracker Privacy & Monitoring

This document describes **what the product does** with employee activity data on a self-hosted instance. It is **not legal advice**. Organizations that deploy TeamTracker are responsible for complying with applicable employment, workplace monitoring, and privacy laws in their jurisdiction (notice, consent, works council rules, data-protection statutes, cross-border transfer rules, etc.).

## What is monitored

The **desktop tracker** (Electron) runs on each enrolled employee machine and typically:

- Samples the **foreground application name** and **window title** on a short interval (on the order of ~10 seconds).
- Batches samples and **syncs activity** to your TeamTracker server (~60 seconds).
- Optionally captures **periodic screenshots** of the primary display when the organization enables that feature in Admin → Organization Settings.
- May support **live view** frames when an admin initiates a live session (subject to privacy blocks).

Category / productivity scoring is derived from app and title heuristics (plus admin overrides such as job role). The server stores activity rows, aggregates for dashboards/reports, and (if enabled) screenshot files.

## Screenshots

- **Off by default** at the organization level until an admin enables periodic screenshots.
- When enabled, the tracker JPEG-compresses captures and uploads them to the server under the org/employee/day path inside `UPLOADS_DIR` (production default: `/var/lib/teamtracker/uploads/screenshots/...`).
- Admins can browse, open, and delete screenshots in the dashboard **Screenshots** page.
- Retention: org setting and/or `SCREENSHOT_RETENTION_DAYS`; older files are removed by server-side retention jobs.

Screenshots can include anything visible on the display (documents, chat, personal sites). Treat enablement as a high-sensitivity decision and inform employees accordingly.

## Privacy blocks

Admins configure **capture privacy blocks** with a **site URL** (e.g. `https://web.whatsapp.com/`) or a native **app name**. Site URLs are stored as a **canonical hostname** (e.g. `web.whatsapp.com`).

The desktop **PrivacyGuard** is the single gate for screenshots and Live Activity (there is no separate video-recording pipeline — continuous viewing is JPEG frames over the live session).

- **Site hostnames (blocklist mode):** blocks capture when a listed host is the **active tab**.
- **Site hostnames (allowlist mode):** blocks capture for **every** website except listed hosts on the active tab.
- **App names:** match open window / process names for native apps.
- **Fail-closed:** when URL rules require browser state and it cannot be verified, PrivacyGuard returns **unknown** and adapters **do not** capture.

When a block matches (or state is unknown with URL rules present):

- Screenshot capture is skipped before `desktopCapturer` runs.
- Live Activity sends empty frames with `privacyBlocked: true` and does not grab pixels.

Privacy blocks reduce risk; they are **not** a guarantee that sensitive content never appears in activity **titles**, residual check→grab races measured in milliseconds (e.g. switching to a blocked tab mid-capture), or browsers we cannot probe (Firefox; Windows/Linux URL rules). Window titles themselves can contain personal or confidential strings. On macOS, grant **Automation** permission for TeamTracker to control your browser so URL matching works; without it, capture stays blocked while URL rules exist.

## Stealth mode (honest description)

The desktop tracker can run in **stealth mode** (`TEAMTRACKER_STEALTH=1`, or installer helpers with a `--stealth` flag):

- No tray / menu-bar icon (and on macOS, dock icon hidden via `LSUIElement`-style behavior when configured).
- Silent background operation while still sampling windows and syncing to the server.

Stealth mode **does not** make monitoring invisible to a determined employee or to OS privacy prompts (e.g. macOS Screen Recording / Accessibility). It also **does not** remove the organization’s duty to disclose monitoring where the law requires it. Use stealth only where lawful and consistent with your employment policies.

## Retention

| Data | Typical control |
|------|-----------------|
| Activity rows in SQLite | Retained until deleted via admin actions / future retention policies; back up with the DB |
| Screenshots on disk | Org retention UI + `SCREENSHOT_RETENTION_DAYS`; auto-delete of aged files |
| SQLite backups | `BACKUP_RETENTION_DAYS` under `BACKUPS_DIR` |
| JWT / device tokens | Bound to `JWT_SECRET`; rotating the secret invalidates sessions |

Exact defaults may change by version — check Organization Settings and `.env.example`.

## Who can access what

- **Organization admins** (dashboard JWT): employees, activity, reports, screenshots (if enabled), privacy blocks, org settings, AI assistant queries over org data.
- **Enrolled devices** (device JWT): upload activity/screenshots for their employee; receive remote commands / settings for that device.
- **Other tenants** on the same server: data is intended to be **org-isolated** in the multi-tenant schema; operators of the VPS can still read the SQLite file and uploads on disk.

Self-hosting operators have **full filesystem access** to `DATABASE_PATH`, `UPLOADS_DIR`, and backups. Protect the VPS and `.env` accordingly.

## Employee visibility

Employees using only the desktop tracker may see little or no UI (especially in stealth mode). They do **not** automatically get a full “what was captured” portal unless you provide one operationally. Plan for:

- Clear workplace notice of what is collected, when, and why
- How to request access/deletion consistent with local law
- How screenshots and titles may expose personal content

## Where data lives (self-host)

On a standard production VPS layout:

```
/var/lib/teamtracker/database/admin.db   # accounts, employees, activity, settings
/var/lib/teamtracker/uploads/            # logos + screenshots
/var/lib/teamtracker/backups/            # DB snapshots
/var/lib/teamtracker/.env                # secrets (JWT, mail keys, etc.)
```

No third-party analytics cloud is required for core tracking. Optional outbound services (email via Resend/SMTP, LLM via DeepSeek) send only what those features need when configured.

## Deletion

Practical deletion paths operators and admins can use:

- **Per-screenshot delete** in the Screenshots UI
- **Deactivate / remove employees** via Employees admin (stops new device association; review whether historical rows/files remain and delete manually if required)
- **Filesystem**: remove paths under `uploads/screenshots/<orgId>/...` and compact/restore DB only with care
- **Full wipe**: stop PM2, delete or replace `admin.db` and uploads (irreversible) — see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)

There is no claim of automatic GDPR/CCPA “right to be forgotten” completeness across WAL files, backups, and log lines. Operators must include **backup copies** when fulfilling deletion requests.

## Compliance reminder

Customers and operators **must** ensure their use of TeamTracker complies with local employment and privacy law. This software provides technical controls (org settings, privacy blocks, retention, access control) but **does not** certify legal compliance, works-council approval, or adequacy of employee notice.
