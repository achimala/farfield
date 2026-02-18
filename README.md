# Farfield

Remote control for AI coding agents — read conversations, send messages, switch models, and monitor agent activity, all from a clean web interface running on your machine.

Currently supports [Codex](https://openai.com/codex) and [OpenCode](https://opencode.ai).

Built by [@anshuchimala](https://x.com/anshuchimala).

This is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI or the OpenCode team.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/achimalap)

<img src="./screenshot.png" alt="Farfield screenshot" width="500" />

## What it does

Farfield connects to locally running coding agents over their sockets and APIs, then exposes a unified web UI at `localhost:4312`. You get:

- **Thread browser** — sidebar grouped by project, with active threads across all enabled agents
- **Chat view** — read and send messages, switch collaboration mode, model, and reasoning effort
- **Plan mode toggle** — flip an agent into plan mode for any thread
- **Agent monitoring** — live stream events, pending user input requests, and interrupt controls
- **Debug tab** — full IPC history, payload inspection, and replay

## Requirements

- Node.js 20+
- pnpm 10+
- Codex desktop app installed and running locally (required when `codex` is enabled)
- OpenCode available locally (required when `opencode` is enabled)

## Install

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

Default behavior:
- Backend: `http://127.0.0.1:4311`
- Frontend: `http://127.0.0.1:4312`
- Enabled agents: `codex`

Agent flag matrix:

```bash
pnpm dev                                  # codex only (default)
pnpm dev -- --agents=opencode             # opencode only
pnpm dev -- --agents=codex,opencode       # both; codex is default
pnpm dev -- --agents=all                  # expands to codex,opencode
pnpm dev:remote                           # remote bind, codex default
pnpm dev -- --remote --agents=opencode    # remote bind + custom agents
```

The frontend proxies `/api` and `/events` to the backend automatically.

### Agent selection rules

- If `--agents` is omitted, Farfield enables `codex`.
- When multiple agents are enabled, the first id in `--agents` is the default agent.
- `all` expands to `codex,opencode`.
- Unknown ids fail fast with a clear error.

## Make it available remotely

To access Farfield from another machine (e.g. a phone or tablet on the same network), use `dev:remote`:

```bash
pnpm dev:remote
```

This binds both the backend and frontend to `0.0.0.0` instead of `127.0.0.1`, making them reachable from any device on your local network via your machine's IP address.

> **Warning:** `dev:remote` exposes Farfield on your local network with no authentication. Only use it on trusted networks. You are responsible for securing access.

## Other commands

```bash
pnpm build       # Build all packages
pnpm test        # Run all tests
pnpm typecheck   # TypeScript type checking across all packages
pnpm lint        # Lint all packages
```

Run a single app:

```bash
pnpm --filter @farfield/server dev
pnpm --filter @farfield/web dev
```

## Project layout

```
apps/
  server/       HTTP + SSE backend (TypeScript)
  web/          React frontend (Vite + Tailwind)
packages/
  codex-protocol/  Zod schemas and inferred types for Codex wire formats
  codex-api/       Typed clients for the Codex app-server and desktop IPC
  opencode-api/    Typed OpenCode SDK adapter layer
scripts/
  sanitize-traces.mjs   Redact trace files for safe fixture use
```

- **`packages/codex-protocol`** is the single source of truth for Codex data shapes. Everything is Zod with hard failures on mismatch.
- **`packages/codex-api`** wraps the Codex IPC socket and app-server HTTP API with typed clients and a high-level service layer.
- **`packages/opencode-api`** wraps OpenCode SDK operations with typed mappers used by the server adapter.
- **`apps/server`** serves the REST and SSE endpoints the UI depends on, and manages agent connection lifecycles.
- **`apps/web`** is a Vite + React + Tailwind app. No heavy framework.

## Trace capture (debug)

The Debug tab lets you record IPC traffic as trace files. Raw traces go in `traces/` (git-ignored). To generate sanitized test fixtures:

```bash
pnpm sanitize:traces
```

Sanitized files land in `packages/codex-protocol/test/fixtures/sanitized/`.

## License

MIT
