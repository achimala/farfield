# Codex Monitor Workspace

A strict, fail-fast monitor for Codex desktop threads.

This repo is a `pnpm` monorepo with a typed protocol layer, a typed API layer,
a TypeScript backend, and a React frontend.

## Principles

- Validate every untrusted payload with Zod.
- Fail fast on shape drift.
- No silent fallback parsing.
- No retry loops that hide protocol problems.
- Keep UI thin and move protocol logic into shared packages.

## Monorepo Layout

- `packages/codex-protocol`
  - Single source of truth for wire and app-server schemas.
  - Exports inferred types and parse helpers.
- `packages/codex-api`
  - Typed app-server client.
  - Typed desktop IPC client.
  - High-level Codex monitor actions and stream reducers.
- `apps/server`
  - HTTP and SSE backend for the monitor UI.
  - Trace capture, history inspection, and replay.
- `apps/web`
  - Vite + React + Tailwind + shadcn-style UI.
  - Chat view + always-visible Debug tab.
- `scripts/sanitize-traces.mjs`
  - Redacts local trace files and emits sanitized fixtures for tests.

## Requirements

- Node.js 20+
- pnpm 10+
- Codex desktop app installed locally

## Install

```bash
pnpm install
```

## Main Commands

```bash
# Build all packages and apps
pnpm build

# Run all tests
pnpm test

# Type/lint checks
pnpm lint
pnpm typecheck

# Start server and web app in parallel
pnpm dev
```

## Run Apps Separately

```bash
# Backend server
pnpm --filter @codex-monitor/server dev

# Frontend web app
pnpm --filter @codex-monitor/web dev
```

Default ports:

- backend: `http://127.0.0.1:4311`
- frontend: `http://127.0.0.1:4312`

The web app proxies `/api` and `/events` to the backend.

## Debug Workflow

The Debug tab includes:

- Trace controls (`start`, `mark`, `stop`)
- Raw history feed
- Captured payload detail
- Replay action for captured outbound IPC entries

Trace files are stored in local `traces/` and are ignored by git.

## Sanitized Trace Fixtures

Generate redacted fixtures from local traces:

```bash
pnpm sanitize:traces
```

This writes sanitized files into:

- `packages/codex-protocol/test/fixtures/sanitized`

Sanitization rules remove or replace:

- user paths and usernames
- conversation text content
- IDs and client identifiers
- sensitive long-form payload content

## API Surface (Backend)

Core routes:

- `GET /api/health`
- `GET /api/threads`
- `GET /api/threads/:threadId`
- `GET /api/threads/:threadId/live-state`
- `GET /api/threads/:threadId/stream-events`
- `GET /api/collaboration-modes`
- `POST /api/threads/:threadId/messages`
- `POST /api/threads/:threadId/collaboration-mode`
- `POST /api/threads/:threadId/user-input`
- `POST /api/threads/:threadId/interrupt`

Debug routes:

- `GET /api/debug/history`
- `GET /api/debug/history/:id`
- `POST /api/debug/replay`
- `GET /api/debug/trace/status`
- `POST /api/debug/trace/start`
- `POST /api/debug/trace/mark`
- `POST /api/debug/trace/stop`
- `GET /api/debug/trace/:id/download`

SSE route:

- `GET /events`

## Package Docs

- Protocol details: `packages/codex-protocol/README.md`
- API layer details: `packages/codex-api/README.md`
