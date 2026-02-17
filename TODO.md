# Codex Monitor Re-Architecture TODO

This file is the source of truth for this rebuild.
Only mark items done when they are fully complete and verified.

## Stage 1: Workspace and Tooling

- [x] Switch to `pnpm` workspaces.
- [x] Define monorepo structure:
  - [x] `apps/server`
  - [x] `apps/web`
  - [x] `packages/codex-protocol`
  - [x] `packages/codex-api`
- [x] Add strict shared TypeScript config.
- [x] Add root scripts for build, test, lint, and dev.
- [x] Update ignore rules to keep private traces and extracted desktop files out of git.

## Stage 2: Protocol Package (`packages/codex-protocol`)

- [x] Create strict Zod schemas for:
  - [x] IPC envelope and message types
  - [x] IPC thread stream events
  - [x] Thread state snapshots and patches
  - [x] Collaboration mode payloads
  - [x] User input request and response payloads
  - [x] App server thread, model, and mode shapes we depend on
- [x] Export inferred TypeScript types from schemas.
- [x] Export fail-fast parse helpers (no silent fallbacks).
- [x] Add unit tests for protocol parsing and validation.
- [x] Write protocol documentation in `packages/codex-protocol/README.md`.

## Stage 3: API Package (`packages/codex-api`)

- [x] Build typed app-server client with strict request and response validation.
- [x] Build typed desktop IPC client with strict frame validation.
- [x] Build a typed high-level service layer for:
  - [x] Send message
  - [x] Set collaboration mode
  - [x] Submit user input
  - [x] Interrupt turn
  - [x] Stream state reduction for live thread state
- [x] Keep behavior fail-fast (no retries, no fallback paths).
- [x] Add tests for API client and service layer behavior.
- [x] Write API package documentation in `packages/codex-api/README.md`.

## Stage 4: Server App (`apps/server`)

- [ ] Rebuild server in TypeScript with strict route schemas.
- [ ] Use protocol and API packages only (thin orchestration).
- [ ] Expose clean routes for:
  - [ ] Health and app status
  - [ ] Thread list and thread detail
  - [ ] Live thread state
  - [ ] Message send, mode set, user input submit, interrupt
  - [ ] Debug trace, raw history, and replay
- [ ] Keep SSE event stream support.
- [ ] Keep trace recording and replay features.
- [ ] Ensure all inbound and outbound payloads are validated.
- [ ] Add tests for route validation and critical behavior.

## Stage 5: Web App (`apps/web`)

- [ ] Create Vite + React + TypeScript app.
- [ ] Add Tailwind CSS and shadcn/ui.
- [ ] Build clean split-view interface with:
  - [ ] Thread list sidebar
  - [ ] Conversation panel
  - [ ] Plan mode controls and pending questions
  - [ ] Always-visible Debug tab with trace/replay tools
- [ ] Keep frontend thin (no protocol logic in UI).
- [ ] Make performance-friendly rendering defaults.
- [ ] Add UI smoke tests for main flows.

## Stage 6: Trace Sanitization and Test Fixtures

- [ ] Build a sanitizer tool for NDJSON traces.
- [ ] Redact all personal or sensitive content:
  - [ ] IDs and thread IDs
  - [ ] Paths and usernames
  - [ ] Message text and prompt content
  - [ ] Any raw payload fields not needed for schema tests
- [ ] Generate sanitized fixtures for tests.
- [ ] Confirm no private conversation text remains in fixtures.

## Stage 7: Documentation and DX Finish

- [ ] Write root `README.md` with:
  - [ ] Architecture overview
  - [ ] Setup and local run
  - [ ] Package responsibilities
  - [ ] Debug workflow
- [ ] Document strict fail-fast principles.
- [ ] Add clear developer commands and examples.
- [ ] Ensure all tests and builds pass from root.

## Stage 8: Final Cleanup

- [ ] Remove legacy files no longer used.
- [ ] Confirm git status only includes intentional files.
- [ ] Final pass on naming consistency and code comments.
