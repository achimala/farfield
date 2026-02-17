# @codex-monitor/codex-api

Typed client layer for Codex app-server and desktop IPC.

## Goals

- Provide a clean TypeScript interface for bidirectional Codex interaction.
- Validate every untrusted payload with strict schemas.
- Fail fast on protocol drift.

## Main Pieces

- `AppServerClient`
  - Typed requests to `codex app-server`.
  - Strict response validation.
- `DesktopIpcClient`
  - Socket framing and strict IPC frame validation.
  - Request/response handling with explicit timeouts.
- `CodexMonitorService`
  - High-level actions:
    - send message
    - set collaboration mode
    - submit user input
    - interrupt turn
- `reduceThreadStreamEvents`
  - Strict reducer for thread stream snapshots and patches.

## Fail-Fast Rules

- No fallback parsers.
- No retry loops.
- Unknown shapes throw immediately.
- Invalid patch operations throw immediately.

## Example

```ts
import {
  AppServerClient,
  CodexMonitorService,
  DesktopIpcClient
} from "@codex-monitor/codex-api";

const app = new AppServerClient({
  executablePath: "/Applications/Codex.app/Contents/Resources/codex",
  userAgent: "codex-monitor-web/0.2.0"
});

const ipc = new DesktopIpcClient({
  socketPath: "/tmp/codex-ipc/ipc-501.sock"
});

await ipc.connect();
await ipc.initialize("codex-monitor-web/0.2.0");

const service = new CodexMonitorService(app, ipc);

await service.sendMessage({
  threadId: "thread-id",
  ownerClientId: "desktop-client-id",
  text: "hello"
});
```
