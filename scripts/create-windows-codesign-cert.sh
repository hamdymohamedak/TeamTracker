#!/usr/bin/env bash
# Create a self-signed Windows Authenticode cert on macOS/Linux (OpenSSL),
# then optionally upload it to GitHub Actions secrets.
#
# Usage:
#   ./scripts/create-windows-codesign-cert.sh
#   ./scripts/create-windows-codesign-cert.sh --upload   # also: gh secret set
#
# Secrets created (with --upload):
#   WIN_CSC_LINK          = base64 of the .pfx
#   WIN_CSC_KEY_PASSWORD  = PFX password
#
# Note: Self-signed certs reduce "unknown publisher" only on machines that
# trust the cert. Public SmartScreen still warns until you use a paid CA cert.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT}/.secrets/windows-codesign"
UPLOAD=0

for arg in "$@"; do
  case "$arg" in
    --upload) UPLOAD=1 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
  esac
done

mkdir -p "$OUT_DIR"
umask 077

PASSWORD="${WIN_CSC_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)}"
CNF="$OUT_DIR/openssl-codesign.cnf"
KEY="$OUT_DIR/teamtracker-codesign.key"
CRT="$OUT_DIR/teamtracker-codesign.crt"
PFX="$OUT_DIR/teamtracker-codesign.pfx"
B64="$OUT_DIR/teamtracker-codesign.pfx.b64"
PASS_FILE="$OUT_DIR/password.txt"

cat >"$CNF" <<'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_codesign
prompt = no

[req_distinguished_name]
CN = TeamTracker
O = TeamTracker
C = EG

[v3_codesign]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

echo "→ Generating self-signed code-signing certificate (5 years)…"
openssl req -x509 -newkey rsa:4096 -sha256 -days 1825 \
  -keyout "$KEY" \
  -out "$CRT" \
  -config "$CNF" \
  -extensions v3_codesign \
  -passout "pass:${PASSWORD}"

openssl pkcs12 -export \
  -out "$PFX" \
  -inkey "$KEY" \
  -in "$CRT" \
  -name "TeamTrackerSigning" \
  -passin "pass:${PASSWORD}" \
  -passout "pass:${PASSWORD}"

# GitHub Actions / electron-builder expect base64 of the PFX bytes
base64 <"$PFX" | tr -d '\n' >"$B64"
printf '%s\n' "$PASSWORD" >"$PASS_FILE"

# Public cert only — safe to commit; NSIS installer embeds + trusts it on install
PUBLIC_CER_DESKTOP="${ROOT}/desktop/assets/TeamTrackerCodeSign.cer"
PUBLIC_CER_ADMIN="${ROOT}/desktop-admin/assets/TeamTrackerCodeSign.cer"
openssl x509 -in "$CRT" -outform DER -out "$PUBLIC_CER_DESKTOP"
cp "$PUBLIC_CER_DESKTOP" "$PUBLIC_CER_ADMIN"

echo
echo "✓ Wrote (gitignored):"
echo "  $PFX"
echo "  $B64"
echo "  $PASS_FILE"
echo "✓ Wrote public cert (commit these):"
echo "  $PUBLIC_CER_DESKTOP"
echo "  $PUBLIC_CER_ADMIN"
echo

if [[ "$UPLOAD" -eq 1 ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "✗ gh CLI not found. Install GitHub CLI, then re-run with --upload."
    exit 1
  fi
  echo "→ Uploading GitHub Actions secrets (WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD)…"
  gh secret set WIN_CSC_LINK --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)" <"$B64"
  printf '%s' "$PASSWORD" | gh secret set WIN_CSC_KEY_PASSWORD --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  echo "✓ Secrets uploaded. Next Windows CI build will use them for Authenticode signing."
else
  echo "Upload manually (or re-run with --upload):"
  echo "  gh secret set WIN_CSC_LINK < \"$B64\""
  echo "  printf '%s' \"\$(cat \"$PASS_FILE\")\" | gh secret set WIN_CSC_KEY_PASSWORD"
fi

echo
echo "Reminder: do NOT commit .pfx / .key / password files. They stay in .secrets/ (gitignored)."
