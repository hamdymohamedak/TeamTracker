# Desktop Tracker Code Signing & Notarization

TeamTracker ships Electron desktop apps (`desktop/`, `desktop-admin/`). **Unsigned builds work** for internal use but trigger OS warnings (Gatekeeper, SmartScreen). This doc lists the **secrets and env vars** needed for Apple notarization and Windows Authenticode signing in CI.

**Never commit** `.pfx` / `.p12` / `.p8` / passwords. Store them as **GitHub Actions encrypted secrets** so CI can sign without keeping certs only on your laptop.

## Prerequisites

| Platform | What you need |
|----------|----------------|
| macOS | Apple Developer Program membership; Developer ID Application certificate; App-specific password or API key for notarization |
| Windows | Authenticode code-signing certificate (OV/EV preferred) as `.pfx` / base64; password — or a **self-signed** cert for internal testing |
| CI | GitHub Actions secrets — never commit certs or passwords |

Tooling: [electron-builder](https://www.electron.build/code-signing).

## Why `zsh: unknown file attribute: 5`?

`New-SelfSignedCertificate` is a **Windows PowerShell** cmdlet. It does **not** run in macOS Terminal (`zsh`). On a Mac, use the OpenSSL script below instead.

## Windows (Authenticode) — create cert on Mac + upload to GitHub

From the repo root:

```bash
chmod +x scripts/create-windows-codesign-cert.sh
./scripts/create-windows-codesign-cert.sh --upload
```

That script:

1. Creates a 5-year self-signed code-signing cert (`CN=TeamTracker, O=TeamTracker, C=EG`)
2. Writes a `.pfx` under `.secrets/windows-codesign/` (gitignored)
3. Uploads GitHub secrets:
   - `WIN_CSC_LINK` — base64 of the `.pfx`
   - `WIN_CSC_KEY_PASSWORD` — PFX password

Without `--upload`, it only writes local files and prints the `gh secret set` commands.

### Manual PowerShell (Windows only)

```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=TeamTracker, O=TeamTracker, C=EG" `
  -FriendlyName "TeamTrackerSigning" `
  -NotAfter (Get-Date).AddYears(5)
```

Then export to `.pfx`, base64-encode it, and set `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` in the repo secrets.

### CI env vars (Windows job)

| Variable | Purpose |
|----------|---------|
| `WIN_CSC_LINK` | Base64-encoded `.pfx` (or path) — **use this on Windows**, not Mac `CSC_LINK` |
| `WIN_CSC_KEY_PASSWORD` | Password for the PFX |

The `build-windows` job in `.github/workflows/build-desktop.yml` passes these into electron-builder. Empty secrets → unsigned build (no failure).

**Self-signed note:** employees’ PCs still show SmartScreen / “Unknown publisher” unless the cert is installed in Trusted Root / Trusted Publishers, or you buy an OV/EV Authenticode cert from a public CA.

### Auto-trust inside the Windows installer (no separate .cer for users)

The public half of the signing cert (`TeamTrackerCodeSign.cer`) is committed under `desktop/assets/` and `desktop-admin/assets/`. The NSIS script `installer.nsh` runs during Setup and imports that cert into the **current user’s** `Root` + `TrustedPublisher` stores via `certutil`.

| What users do | What happens |
|---------------|--------------|
| Run `TeamTracker Setup.exe` once | Installer trusts publisher + installs app |
| No PowerShell / no extra download | Works offline if the Setup file is intact |

**Cannot do:** have the app “re-sign itself” before launch. Signing needs the **private** key; shipping that key inside the app lets anyone forge TeamTracker malware. Trusting the **public** cert at install time is the safe equivalent of your idea.

**Still true:** the *first* download of Setup.exe may show SmartScreen (Mark-of-the-Web) until the user clicks Run anyway once — the cert import only runs *inside* that install. After that, signed installed binaries should show publisher `TeamTracker` as trusted for that user. A paid CA cert is the only way to avoid first-run SmartScreen for strangers on the internet.

When you rotate the signing cert (`./scripts/create-windows-codesign-cert.sh --upload`), commit the refreshed `.cer` files so installers match `WIN_CSC_LINK`.

## macOS (Developer ID + notarization)

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Path or base64 of the **Developer ID Application** `.p12` |
| `CSC_KEY_PASSWORD` | P12 password |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password ([appleid.apple.com](https://appleid.apple.com)) |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `API_KEY_ID` / `API_KEY_ISSUER_ID` / `API_KEY` (or `APPLE_API_KEY` path) | Alternative: App Store Connect API key for notarization |

Also ensure electron-builder mac options appropriate for distribution:

- `hardenedRuntime: true`
- Entitlements file for Electron (camera/screen capture as required by your build)
- `notarize: true` (electron-builder 24+) **or** a `afterSign` notarize hook

Bundle IDs: `com.teamtracker.tracker`, `com.teamtracker.admin`.

## Suggested GitHub Actions secret names

```text
# macOS
CSC_LINK
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID

# Windows (separate from Mac — different cert type)
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

## What not to do

- Do not commit `.p12` / `.pfx` / `.p8` files to git (use secrets).
- Do not reuse Mac `CSC_LINK` as the Windows signing cert.
- Do not “fake” notarization stapling in docs or CI logs.
- Do not rotate `CSC_*` / `WIN_CSC_*` mid-release without rebuilding all platform artifacts employees install.

## Unsigned internal distribution

For private fleets you may ship unsigned AppImages / DMGs / EXEs and document SmartScreen/Gatekeeper steps in the main README. Prefer a public CA cert before any broad employee rollout.
