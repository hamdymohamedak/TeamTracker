# Desktop Tracker Code Signing & Notarization

TeamTracker ships an Electron desktop app (`desktop/`). **Unsigned builds work** for internal use but trigger OS warnings (Gatekeeper, SmartScreen). This doc lists the **secrets and env vars** needed for real Apple notarization and Windows Authenticode signing in CI. It does **not** fabricate certificates or claim the open-source repo already signs releases.

Current `desktop/package.json` electron-builder config intentionally disables production signing defaults (`mac.identity: null`, `win.signAndEditExecutable: false`) so local/dev builds do not fail without certs. Enable signing only when secrets are present.

## Prerequisites

| Platform | What you need |
|----------|----------------|
| macOS | Apple Developer Program membership; Developer ID Application certificate; App-specific password or API key for notarization |
| Windows | Authenticode code-signing certificate (OV/EV) as `.pfx` / base64; password |
| CI | Secure secret store (GitHub Actions encrypted secrets, etc.) — never commit certs or passwords |

Tooling: [electron-builder](https://www.electron.build/code-signing) (already a desktop dependency).

## Windows (Authenticode)

electron-builder / `@electron/windows-sign` conventionally read:

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Path to `.pfx` **or** base64-encoded PFX contents (common in CI) |
| `CSC_KEY_PASSWORD` | Password for the PFX |
| `CSC_NAME` | Optional subject name if multiple certs |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows-only overrides when also signing mac in the same job |

When these are set, remove or override `signAndEditExecutable: false` in the win build config (or set `"signDlls": true` as needed for your cert policy).

EV tokens / hardware HSMs may require vendor-specific signing steps instead of a raw PFX — follow your CA’s CI guide.

## macOS (Developer ID + notarization)

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Path or base64 of the **Developer ID Application** `.p12` |
| `CSC_KEY_PASSWORD` | P12 password |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password ([appleid.apple.com](https://appleid.apple.com)) |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `API_KEY_ID` / `API_KEY_ISSUER_ID` / `API_KEY` (or `APPLE_API_KEY` path) | Alternative: App Store Connect API key for notarization (preferred over account password in many CI setups) |

Also ensure electron-builder mac options appropriate for distribution:

- `hardenedRuntime: true`
- Entitlements file for Electron (camera/screen capture as required by your build)
- `notarize: true` (electron-builder 24+) **or** a `afterSign` notarize hook

Bundle ID used by the project: `com.teamtracker.tracker`.

Without a valid Developer ID + notarization, employees must bypass Gatekeeper (“Open Anyway”), and permissions may be less stable across updates.

## Suggested GitHub Actions secret names

Use the same names in workflow `env:` so builders pick them up:

```text
CSC_LINK
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
# optional API-key notarization:
APPLE_API_KEY_ID
APPLE_API_ISSUER_ID
APPLE_API_KEY          # base64 or file contents of AuthKey_*.p8
```

Example job fragment (illustrative — adjust to your workflow):

```yaml
- name: Build signed desktop
  working-directory: desktop
  env:
    CSC_LINK: ${{ secrets.CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: |
    npm ci
    npm run dist:mac
    # npm run dist:win  # on windows runner with WIN cert secrets
```

Run mac signing on **macOS runners**. Run Windows signing on **windows-latest** (or a self-hosted Windows agent with the cert).

## What not to do

- Do not commit `.p12` / `.pfx` / `.p8` files to git.
- Do not “fake” notarization stapling in docs or CI logs.
- Do not distribute builds that claim to be signed when `identity` is null.
- Do not rotate `CSC_*` mid-release without rebuilding all platform artifacts employees install.

## Unsigned internal distribution

For private fleets you may ship unsigned AppImages / DMGs / EXEs and document SmartScreen/Gatekeeper steps in the main README. Prefer signing before any broad employee rollout.
