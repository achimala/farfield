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
