# Live View — WebRTC, TURN, Binary WS, and transport-aware profiles

TeamTracker Live View prefers **WebRTC** (employee → admin peer connection). The VPS handles authentication, session coordination, and WebRTC **signaling** over the existing `/ws` WebSocket. When peer connectivity fails (common on CGNAT), the client automatically falls back to **binary JPEG frames** relayed through the VPS (no Base64).

## Architecture

```text
Admin  ←signaling→  VPS  ←signaling→  Employee
Admin  ←── WebRTC media (P2P / TURN) ──→  Employee
Admin  ←── binary WS frames (fallback) ─→  VPS ←── Employee
```

High FPS (LAN profiles) only applies on **WebRTC P2P**. Video frames never traverse the application server on P2P; Binary WS keeps VPS-safe FPS caps.

## Network path detection

The admin viewer classifies the selected ICE candidate pair (not a security boundary):

| Path | Rule | Performance profile |
|------|------|---------------------|
| `webrtc-p2p-lan` | Both candidates `host`/`prflx`, no relay, RTT ≤ `LIVE_VIEW_LAN_RTT_MAX_MS` | Higher FPS |
| `webrtc-p2p-internet` | P2P but `srflx` or high RTT | Internet-safe |
| `webrtc-turn` | Local or remote candidate is `relay` | Same as Internet |
| `binary-ws` | WebRTC failed / fallback | Hard `LIVE_VIEW_MAX_FPS` clamp |

Preferred quality/FPS is remembered across Binary WS fallback and restored when WebRTC P2P LAN returns. Bounded re-promote attempts restart WebRTC from fallback using the existing publisher.

## Environment variables

Add to the admin server `.env` (all optional; defaults keep Live View working without TURN):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIVE_VIEW_DEFAULT_QUALITY` | `auto` | `auto` / `low` / `medium` / `high` / `ultra` (Ultra is LAN-only in UI) |
| `LIVE_VIEW_MAX_FRAME_BYTES` | `220000` | Max JPEG payload for binary frames |
| `LIVE_VIEW_MAX_FPS` / `LIVE_VIEW_MIN_FPS` | `4` / `1` | **Binary WS** hard FPS caps |
| `LAN_LIVE_VIEW_MAX_FPS` | `30` | LAN P2P max FPS |
| `LAN_LIVE_VIEW_DEFAULT_FPS` | `12` | Default LAN Medium FPS |
| `INTERNET_LIVE_VIEW_MAX_FPS` | `4` | Internet WebRTC max FPS |
| `TURN_LIVE_VIEW_MAX_FPS` | `4` | TURN max FPS |
| `LIVE_VIEW_LAN_RTT_MAX_MS` | `40` | Max RTT (ms) to treat host/prflx P2P as LAN |
| `LIVE_VIEW_AUTO_UPGRADE_DELAY` | `20000` | ms healthy before Auto upgrades |
| `LIVE_VIEW_AUTO_DOWNGRADE_THRESHOLD` | `1500` | latency ms → downgrade |
| `LIVE_VIEW_AUTO_DOWNGRADE_COOLDOWN` | `3000` | min gap between downgrades |
| `LIVE_VIEW_WEBRTC_ENABLED` | `1` | Prefer WebRTC |
| `LIVE_VIEW_WS_FALLBACK_ENABLED` | `1` | Allow binary WS fallback |
| `STUN_SERVERS` | Google public STUN | Comma-separated STUN URLs |
| `TURN_URLS` | _(empty)_ | Comma-separated TURN URLs |
| `TURN_SECRET` | _(empty)_ | Coturn `static-auth-secret` (preferred) |
| `TURN_CREDENTIAL_TTL` | `3600` | Short-lived TURN credential TTL (seconds) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | _(empty)_ | Static TURN auth if secret unset |

When `TURN_SECRET` is set, the server mints time-limited credentials (`expiry:orgId` + HMAC-SHA1) and embeds them in `admin:live-view-status` / `command:live-view-start`. **Never log TURN secrets or credentials.**

## Coturn (example)

Install coturn on the VPS and open UDP/TCP **3478** (and relay ports as configured).

`/etc/turnserver.conf` sketch:

```conf
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=REPLACE_WITH_LONG_RANDOM
realm=tracker.example.com
total-quota=100
stale-nonce=600
no-multicast-peers
no-cli
```

Admin `.env`:

```env
STUN_SERVERS=stun:tracker.example.com:3478
TURN_URLS=turn:tracker.example.com:3478?transport=udp,turn:tracker.example.com:3478?transport=tcp
TURN_SECRET=REPLACE_WITH_LONG_RANDOM
TURN_CREDENTIAL_TTL=3600
```

Without TURN, WebRTC may still work on some networks via STUN; otherwise Live View uses **binary WebSocket fallback** automatically.

## Nginx notes

Ensure WebSocket upgrade is enabled for `/ws` and that proxy buffering does not break binary frames:

```nginx
location /ws {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400;
  proxy_buffering off;
}
```

## Quality presets (transport-aware)

Logical presets stay `Auto` / `Low` / `Medium` / `High` (+ LAN-only `Ultra`). Effective width/FPS come from `transport-profiles.ts`:

| Path | Low | Medium (default) | High | Ultra |
|------|-----|------------------|------|-------|
| LAN P2P | 720p @ 5 | 720p @ 12 | 1080p @ 18 | 1080p @ 30 |
| Internet / TURN | 480p @ 2 | 720p @ 2.5 | 1280p @ 3.5 | hidden → High |
| Binary WS | Internet widths | FPS ≤ `LIVE_VIEW_MAX_FPS` | same clamp | never |

Dashboard FPS options are discrete and path-bound (e.g. LAN: 5/10/12/15/20/30; Internet/TURN/WS: 1–4). Auto on LAN raises FPS before resolution; CPU / dropped-frame pressure steps FPS down.

Admins can change quality live via `admin:live-view-quality` → `command:live-view-quality` (includes `fps` / `width` / `networkPath`) without restarting the session.

## Security

- Same JWT auth on `/ws` as before (`dashboard` vs `device`).
- Signaling and binary frames are scoped to an active `LiveViewSession` (`sessionId` + `orgId`).
- One admin viewer per employee; takeover ends the previous session.
- No Live View frames are stored on disk or in the database.
- **LAN detection never grants permissions** — it only changes the performance profile.
