# Farfield

A local UI for the [Codex](https://openai.com/codex) app — read your conversations, send messages, switch models, and monitor agent activity, all from a clean web interface running on your machine.

Built by [@anshuchimala](https://x.com/anshuchimala).

<img src="./screenshot.png" alt="Farfield screenshot" width="500" />

## What it does

Farfield connects to the Codex desktop app over its local IPC socket and app-server API, then exposes a polished web UI at `localhost:4312`. You get:

- **Thread browser** — sidebar grouped by project with all your active Codex threads
- **Chat view** — read and send messages, switch collaboration mode, model, and reasoning effort
- **Plan mode toggle** — flip Codex into plan mode for any thread
- **Agent monitoring** — live stream events, pending user input requests, and interrupt controls
- **Debug tab** — full IPC history, payload inspection, and replay

## Requirements

- Node.js 20+
- pnpm 10+
- Codex desktop app installed and running locally

## Install

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

That's it. Both the backend and frontend start in parallel.

- Backend: `http://127.0.0.1:4311`
- Frontend: `http://127.0.0.1:4312` — open this in your browser

The frontend proxies `/api` and `/events` to the backend automatically.

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
  protocol/     Zod schemas and inferred types for all wire formats
  api/          Typed clients for the Codex app-server and desktop IPC
scripts/
  sanitize-traces.mjs   Redact trace files for safe fixture use
```

- **`packages/protocol`** is the single source of truth for all data shapes. Everything is Zod — no silent coercion, no shape drift, hard failures on unknown payloads.
- **`packages/api`** wraps the Codex IPC socket and app-server HTTP API with typed clients and a high-level service layer.
- **`apps/server`** serves the REST and SSE endpoints the UI depends on, and manages the IPC connection lifecycle.
- **`apps/web`** is a Vite + React + Tailwind app. No heavy framework.

## Trace capture (debug)

The Debug tab lets you record IPC traffic as trace files. Raw traces go in `traces/` (git-ignored). To generate sanitized test fixtures:

```bash
pnpm sanitize:traces
```

Sanitized files land in `packages/protocol/test/fixtures/sanitized/`.

## License

MIT
