# @farfield/protocol

Strict schemas and types for Farfield's Codex protocol handling.

## Goals

- Fail fast when payloads drift.
- Keep one source of truth for wire and app-server data shapes.
- Export inferred TypeScript types from Zod schemas.

## What This Package Covers

- IPC frame schemas:
  - `initialize`
  - `request`
  - `response`
  - `broadcast`
- Thread stream schemas:
  - `thread-stream-state-changed` broadcast envelope
  - `snapshot` and `patches` change payloads
  - patch operations and paths
- Conversation state schemas:
  - thread turns and supported item types
  - pending user input requests
  - collaboration mode fields
- App-server response schemas we depend on:
  - list threads
  - read thread
  - list models
  - list collaboration modes

## Parse Helpers

Use parse helpers when reading any untrusted payload:

- `parseIpcFrame`
- `parseThreadStreamStateChangedBroadcast`
- `parseThreadConversationState`
- `parseUserInputResponsePayload`
- `parseAppServerListThreadsResponse`
- `parseAppServerReadThreadResponse`
- `parseAppServerListModelsResponse`
- `parseAppServerCollaborationModeListResponse`

All helpers throw `ProtocolValidationError` with issue paths.

## Strictness Policy

- Schemas use `.passthrough()` by default.
- Unknown fields are allowed and preserved.
- Required known fields are still validated with exact types.

## Development

```bash
bun run --filter @farfield/protocol build
bun run --filter @farfield/protocol test
```

## Generated App-Server Schemas

The app-server schemas in this package are generated from the official Codex app-server schema output.

From repo root:

```bash
bun run generate:codex-schema
```

This regenerates:

- `packages/codex-protocol/vendor/codex-app-server-schema/`
- `packages/codex-protocol/src/generated/app-server/`
