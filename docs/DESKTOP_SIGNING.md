# Desktop distribution & optional code signing

TeamTracker ships two Electron apps (`desktop/`, `desktop-admin/`) via **electron-builder** and GitHub Actions (`.github/workflows/build-desktop.yml`).

## Default model (recommended for small teams)

**Ship unsigned builds. Do not buy signing certificates until users and revenue justify the cost.**

```text
Build
  ↓
Unsigned Windows installer + unsigned macOS DMG/ZIP
  ↓
GitHub Release
```

Missing signing secrets must **never** fail the release pipeline. CI unsets empty cert env vars and builds normally.

| Platform | Artifact examples | Without paid signing |
|----------|-------------------|----------------------|
| Windows | `TeamTracker-*-x64.exe`, `TeamTracker-Admin-Setup-*.exe` | SmartScreen / “Unknown publisher” may appear |
| macOS | `TeamTracker-*-arm64.dmg`, `TeamTracker-Admin-*-arm64.dmg` | Gatekeeper may block until the user allows the app |

Ad-hoc macOS signing (`codesign --sign -` via `afterPack`) only stabilizes the bundle identity for TCC permissions. It is **not** Apple Developer ID trust and does **not** remove Gatekeeper warnings.

### What we deliberately do **not** do

- Buy OV/EV / Apple Developer certificates “just to quiet warnings”
- Bundle self-signed certificates or install them into users’ trust stores
- Pretend self-signed Authenticode is equivalent to a public CA
- Disable Gatekeeper, SmartScreen, or antivirus
- Claim “Verified by Apple”, “Trusted Publisher”, or “officially signed” when unsigned

---

## macOS — unsigned install (employees)

1. Open the `.dmg` and drag the app to **Applications**.
2. First launch may show that Apple cannot verify the developer.
3. Allow it **for this app only**:
   - **Right-click** the app → **Open** → **Open**, or
   - **System Settings → Privacy & Security** → scroll to the blocked-app message → **Open Anyway**
4. Grant **Screen Recording** and **Accessibility** when prompted (employee tracker).

Do **not** turn Gatekeeper off globally.

---

## Windows — unsigned install (employees)

1. Run the NSIS `.exe` installer.
2. If SmartScreen shows **Windows protected your PC**:
   - Click **More info** → **Run anyway**
3. Complete the installer wizard.

Do **not** disable SmartScreen or Windows Defender globally.

An unknown-publisher / reputation warning on a new unsigned build is expected. It does not mean the installer is malware; it means Windows has no paid Authenticode reputation for this binary yet.

---

## CI behavior

| Secrets | Result |
|---------|--------|
| **Absent** | Unsigned Windows + unsigned macOS (ad-hoc identity) + Linux → release succeeds |
| **Present** | Same pipeline uses them for signing (and notarization later when configured) |

macOS packaging runs on **two runner types** so Intel MacBooks are covered on real hardware:

| Runner | CPU | Artifact examples |
|--------|-----|-------------------|
| `macos-latest` | Apple Silicon (arm64) | `TeamTracker-*-arm64.dmg` |
| `macos-15-intel` | Intel (x64) | `TeamTracker-*-x64.dmg` |

Each Mac job builds only its native arch and verifies the binary architecture with `file` before uploading.

Relevant secrets (only when you later add paid certs):

```text
# macOS (Developer ID Application .p12)
CSC_LINK
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID

# Windows (public-CA Authenticode .pfx) — separate from Mac
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

Empty secrets are unset before electron-builder runs so `""` is never treated as a file path.

---

## Future upgrade path (paid certificates)

When commercial signing becomes worthwhile:

```text
Build
  ↓
Code signing (Developer ID / Authenticode)
  ↓
Notarization (macOS) when Apple credentials are complete
  ↓
Release
```

### macOS (later)

1. Enroll in the Apple Developer Program; create a **Developer ID Application** certificate; export `.p12`.
2. Store `CSC_LINK` (base64 of `.p12`) + `CSC_KEY_PASSWORD` as GitHub secrets.
3. For notarization: set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
4. In each app’s `package.json` → `"build"."mac"`, add `"notarize": true` (electron-builder 24+) once those secrets exist.

Both apps already use `hardenedRuntime` + entitlements so notarization can be enabled without a packaging rewrite.

### Windows (later)

1. Purchase an Authenticode certificate from a public CA (OV/EV as appropriate).
2. Store `WIN_CSC_LINK` (base64 of `.pfx`) + `WIN_CSC_KEY_PASSWORD`.
3. Rebuild — electron-builder signs when `WIN_CSC_*` is set.

Do **not** reuse Mac `CSC_LINK` as the Windows cert.

Tooling reference: [electron-builder code signing](https://www.electron.build/code-signing).

**Never commit** `.pfx` / `.p12` / `.p8` / passwords. Use GitHub Actions encrypted secrets.

---

## Local build commands

From a **standalone copy** of `desktop/` or `desktop-admin/` (avoids npm workspace conflicts with electron-builder):

```bash
# Unsigned by default (recommended)
export CSC_IDENTITY_AUTO_DISCOVERY=false
unset CSC_LINK CSC_KEY_PASSWORD WIN_CSC_LINK WIN_CSC_KEY_PASSWORD

npm install
npm run dist:mac    # DMG + ZIP (macOS host)
npm run dist:win    # NSIS installer (best on Windows CI / Windows host)
```

Output: `release/` under that app directory.

---

## Related

- Employee install overview: [README.md](../README.md)
- Server deploy: [DEPLOYMENT.md](./DEPLOYMENT.md)
