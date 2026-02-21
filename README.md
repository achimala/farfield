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

> **Warning:** `dev:remote` exposes Farfield with no authentication. Only use on trusted networks.

## Requirements

- Node.js 20+
- Bun 1.2+
- Codex or OpenCode installed locally

## Unified Architecture

Farfield now routes both providers through one strict unified surface.

- Server entrypoints for the web app are under `/api/unified/*`.
- Codex runs through native app-server methods only.
- OpenCode runs through SDK type mappings only.
- Web UI consumes unified schemas and does not import provider SDK/protocol types.
- Feature gating comes from typed unified feature availability, not provider-specific conditionals in UI logic.

### Unified Endpoints

- `POST /api/unified/command`
- `GET /api/unified/features`
- `GET /api/unified/threads`
- `GET /api/unified/thread/:id`
- `GET /api/unified/events` (SSE)

## Strict Checks

Run this before pushing:

```bash
bun run verify:strict
```

This runs:

- `verify:no-cheats`
- `verify:no-provider-ui-imports`
- workspace `typecheck`
- workspace `test`
- generated artifact cleanliness checks for Codex and OpenCode manifests

## Codex Schema Sync

Farfield now vendors official Codex app-server schemas and generates protocol Zod validators from them.

```bash
bun run generate:codex-schema
```

This command updates:

- `packages/codex-protocol/vendor/codex-app-server-schema/` (stable + experimental TypeScript and JSON Schema)
- `packages/codex-protocol/src/generated/app-server/` (generated Zod schema modules used by the app)

## OpenCode Manifest Sync

Farfield also generates an OpenCode manifest from SDK unions used by the mapper layer.

```bash
bun run generate:opencode-manifest
```

## Provider Schema Update Flow

When Codex or OpenCode updates protocol/SDK shapes:

1. Run `bun run generate:codex-schema`
2. Run `bun run generate:opencode-manifest`
3. Run `bun run verify:strict`
4. Commit generated changes together with any mapper updates

## Release Checklist

1. Run `bun run verify:strict`
2. Confirm `bun run generate:codex-schema` produces no uncommitted changes
3. Confirm `bun run generate:opencode-manifest` produces no uncommitted changes
4. Review `git status` for only intended files
5. Ship only after all workspace tests pass

## License

MIT
