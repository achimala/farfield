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
