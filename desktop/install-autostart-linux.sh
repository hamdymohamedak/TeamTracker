#!/usr/bin/env bash
# TeamTracker: install Linux autostart so the tracker
# - launches when the user logs into a graphical session
# - can optionally run in stealth mode (no tray icon)
#
# Creates BOTH:
#   1. ~/.config/autostart/teamtracker.desktop   (XDG Autostart — works on
#      GNOME, KDE, XFCE, Cinnamon, most desktop environments)
#   2. ~/.config/systemd/user/teamtracker-tracker.service  (optional KeepAlive
#      via systemd --user; enabled when systemd --user is available)
#
# Usage:
#   cd desktop && ./install-autostart-linux.sh [--stealth] [/path/to/TeamTracker.AppImage]
#
# If no AppImage path is given, falls back to the Electron binary from the
# monorepo (dev / from-source installs).
#
# Uninstall:
#   rm -f ~/.config/autostart/teamtracker.desktop
#   systemctl --user disable --now teamtracker-tracker.service 2>/dev/null || true
#   rm -f ~/.config/systemd/user/teamtracker-tracker.service

set -euo pipefail

STEALTH=0
APP_PATH=""

for arg in "$@"; do
  case "$arg" in
    --stealth) STEALTH=1 ;;
    -*)
      echo "Unknown flag: $arg"
      exit 1
      ;;
    *)
      APP_PATH="$arg"
      ;;
  esac
done

DESKTOP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"

# Resolve what to launch
if [[ -n "$APP_PATH" ]]; then
  if [[ ! -x "$APP_PATH" && ! -f "$APP_PATH" ]]; then
    echo "ERROR: AppImage / binary not found: $APP_PATH"
    exit 1
  fi
  chmod +x "$APP_PATH" 2>/dev/null || true
  EXEC_LINE="$APP_PATH"
  WORK_DIR="$(dirname "$APP_PATH")"
elif [[ -x "$REPO_ROOT/node_modules/.bin/electron" ]]; then
  EXEC_LINE="$REPO_ROOT/node_modules/.bin/electron $DESKTOP_DIR"
  WORK_DIR="$DESKTOP_DIR"
else
  echo "ERROR: No AppImage path given and electron not found at $REPO_ROOT/node_modules/.bin/electron"
  echo "Usage: $0 [--stealth] [/path/to/TeamTracker.AppImage]"
  exit 1
fi

mkdir -p "$HOME/.config/autostart"

DESKTOP_FILE="$HOME/.config/autostart/teamtracker.desktop"
# XDG Autostart .desktop — Exec cannot easily set env vars portably, so we
# wrap through env when stealth is on.
if [[ "$STEALTH" == "1" ]]; then
  EXEC_FIELD="env TEAMTRACKER_STEALTH=1 $EXEC_LINE"
else
  EXEC_FIELD="$EXEC_LINE"
fi

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=TeamTracker
Comment=TeamTracker activity tracker
Exec=$EXEC_FIELD
Path=$WORK_DIR
Icon=utilities-system-monitor
Terminal=false
Categories=Utility;Office;
X-GNOME-Autostart-enabled=true
StartupNotify=false
EOF

echo "Wrote $DESKTOP_FILE"

# systemd --user KeepAlive (best-effort)
if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  SERVICE_FILE="$HOME/.config/systemd/user/teamtracker-tracker.service"

  # Split Exec into binary + args for systemd ExecStart
  # shellcheck disable=SC2086
  read -r -a EXEC_PARTS <<< "$EXEC_LINE"
  EXEC_START="${EXEC_PARTS[0]}"
  EXEC_ARGS=""
  if [[ ${#EXEC_PARTS[@]} -gt 1 ]]; then
    EXEC_ARGS="${EXEC_PARTS[*]:1}"
  fi

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=TeamTracker Desktop Tracker
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
WorkingDirectory=$WORK_DIR
Environment=TEAMTRACKER_STEALTH=$STEALTH
Environment=DISPLAY=${DISPLAY:-:0}
Environment=XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
ExecStart=$EXEC_START $EXEC_ARGS
Restart=on-failure
RestartSec=5
# Don't kill the tracker when the user logs out of a TTY — only when the
# graphical session ends (PartOf=graphical-session.target).

[Install]
WantedBy=graphical-session.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now teamtracker-tracker.service
  echo "Enabled systemd --user service teamtracker-tracker.service"
else
  echo "systemd --user not available — relying on XDG Autostart only (starts at next login)."
fi

echo ""
echo "Autostart installed."
if [[ "$STEALTH" == "1" ]]; then
  echo "Stealth mode: ON (no tray icon)"
else
  echo "Stealth mode: OFF. Re-run with --stealth to hide the tray."
fi
echo ""
echo "Linux tips:"
echo "  • X11: install xdotool for reliable window titles (sudo apt install xdotool)"
echo "  • GNOME Wayland: install the 'Focused Window D-Bus' GNOME Shell extension"
echo "  • Hyprland: hyprctl is used automatically when on PATH"
echo "  • KDE Wayland: install kdotool for window titles"
echo "  • Screenshots on Wayland may prompt once via the desktop portal (PipeWire)"
