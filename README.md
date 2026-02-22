# Farfield

Remote control for AI coding agents — read conversations, send messages, switch models, and monitor agent activity from a clean web UI.

Supports [Codex](https://openai.com/codex) and [OpenCode](https://opencode.ai).

Built by [@anshuchimala](https://x.com/anshuchimala).

This is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI or the OpenCode team.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/achimalap)

<img src="./screenshot.png" alt="Farfield screenshot" width="500" />

## Features

- Thread browser grouped by project
- Chat view with model/reasoning controls
- Plan mode toggle
- Live agent monitoring and interrupts
- Debug tab with full IPC history

## Install & Run

```bash
bun install
bun run dev
```

Opens at `http://localhost:4312`. Defaults to Codex.

**Agent options:**

```bash
bun run dev -- --agents=opencode             # OpenCode only
bun run dev -- --agents=codex,opencode       # both
bun run dev -- --agents=all                  # expands to codex,opencode
bun run dev:remote                           # network-accessible (codex)
bun run dev:remote -- --agents=opencode      # network-accessible (opencode)
```

## Cloudflare Access (Recommended for iPhone)

Farfield can enforce Cloudflare Access JWTs at the server layer.

Set these environment variables before starting the server:

```bash
export FARFIELD_AUTH_MODE=cloudflare-access
export CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
export CF_ACCESS_AUDIENCE=<cloudflare-access-aud-tag>
export FARFIELD_CORS_ORIGIN=https://farfield.example.com
export FARFIELD_DEBUG_API_ENABLED=false
```

Run in remote mode:

```bash
bun run dev:remote
```

Create a Cloudflare Tunnel and route `https://farfield.example.com` to `http://127.0.0.1:4312`.

Create a Cloudflare Access self-hosted app for the same hostname and require login (and optionally WARP/device posture).

Notes:

- `FARFIELD_AUTH_MODE=cloudflare-access` requires a valid `cf-access-jwt-assertion` header on `/api/*` and `/events`.
- Debug endpoints (`/api/debug/*`) are disabled by default in this mode.
- In local mode (`FARFIELD_AUTH_MODE=none`), debug endpoints stay enabled by default.

### Keep It Always On (macOS launchd)

If you want Farfield reachable from iPhone whenever your Mac is online, install the app, tunnel, and awake services.

Templates and installer live in `scripts/launchd/`.

Set required variables:

```bash
export FARFIELD_DIR="$HOME/Code/farfield"
export FARFIELD_NODE_BIN="$(command -v node)"
export FARFIELD_CLOUDFLARED_BIN="$(command -v cloudflared)"
export FARFIELD_TUNNEL_NAME="farfield"
export FARFIELD_CLOUDFLARED_CONFIG="$HOME/.cloudflared/config.yml"
export FARFIELD_CLOUDFLARED_CERT="$HOME/.cloudflared/cert.pem"
export FARFIELD_HOSTNAME="farfield.example.com"
# optional override if you keep env elsewhere:
# export FARFIELD_ENV_FILE="$HOME/.config/farfield/farfield.env"
```

Create app environment file (used by `scripts/launchd/run-farfield-app.sh`):

```bash
mkdir -p "$HOME/.config/farfield"
cp scripts/launchd/farfield.env.example "$HOME/.config/farfield/farfield.env"
$EDITOR "$HOME/.config/farfield/farfield.env"
```

Install services:

```bash
cd "$FARFIELD_DIR"
scripts/launchd/install-macos-services.sh
```

This installs:

- `com.farfield.app` (user LaunchAgent): runs `node scripts/dev.mjs --remote`
- `com.farfield.awake` (user LaunchAgent): runs `caffeinate -dimsu`
- `com.farfield.tunnel` (system LaunchDaemon): runs `cloudflared tunnel run farfield`

Check service state:

```bash
launchctl print "gui/$(id -u)/com.farfield.app" | head -n 40
launchctl print "gui/$(id -u)/com.farfield.awake" | head -n 40
sudo launchctl print system/com.farfield.tunnel | head -n 40
```

Verify remote health:

```bash
FARFIELD_HOSTNAME="$FARFIELD_HOSTNAME" FARFIELD_TUNNEL_NAME="$FARFIELD_TUNNEL_NAME" scripts/launchd/farfield-healthcheck.sh
```

Logs:

```bash
tail -f "$HOME/Library/Logs/farfield/app.out.log"
tail -f "$HOME/Library/Logs/farfield/app.err.log"
tail -f "$HOME/Library/Logs/farfield/tunnel.err.log"
```

Troubleshooting:

- If tunnel service repeatedly exits with cert errors, confirm `FARFIELD_CLOUDFLARED_CERT` points to a valid `cert.pem`.
- If you see Cloudflare `1033` / `530`, run `cloudflared tunnel info farfield` and ensure at least one active connector exists.
- If DNS resolver timeouts appear in tunnel logs, set static resolvers with `TUNNEL_DNS_RESOLVER_ADDRS` (already set in `scripts/launchd/run-farfield-tunnel.sh` by default).

## Requirements

- Node.js 20+
- Bun 1.2+
- Codex or OpenCode installed locally

## Codex Schema Sync

Farfield now vendors official Codex app-server schemas and generates protocol Zod validators from them.

```bash
bun run generate:codex-schema
```

This command updates:

- `packages/codex-protocol/vendor/codex-app-server-schema/` (stable + experimental TypeScript and JSON Schema)
- `packages/codex-protocol/src/generated/app-server/` (generated Zod schema modules used by the app)

## License

MIT
