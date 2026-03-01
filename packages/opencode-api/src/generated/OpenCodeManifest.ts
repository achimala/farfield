// GENERATED FILE. DO NOT EDIT.
// Source: packages/opencode-api/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts

export const OPENCODE_EVENT_TYPES = [
  "command.executed",
  "file.edited",
  "file.watcher.updated",
  "installation.update-available",
  "installation.updated",
  "lsp.client.diagnostics",
  "lsp.updated",
  "message.part.removed",
  "message.part.updated",
  "message.removed",
  "message.updated",
  "permission.replied",
  "permission.updated",
  "pty.created",
  "pty.deleted",
  "pty.exited",
  "pty.updated",
  "server.connected",
  "server.instance.disposed",
  "session.compacted",
  "session.created",
  "session.deleted",
  "session.diff",
  "session.error",
  "session.idle",
  "session.status",
  "session.updated",
  "todo.updated",
  "tui.command.execute",
  "tui.prompt.append",
  "tui.toast.show",
  "vcs.branch.updated"
] as const;

export type OpenCodeEventType = typeof OPENCODE_EVENT_TYPES[number];

export const OPENCODE_PART_TYPES = [
  "agent",
  "compaction",
  "file",
  "patch",
  "reasoning",
  "retry",
  "snapshot",
  "step-finish",
  "step-start",
  "subtask",
  "text",
  "tool"
] as const;

export type OpenCodePartType = typeof OPENCODE_PART_TYPES[number];

export const OPENCODE_TOOL_STATE_STATUSES = [
  "completed",
  "error",
  "pending",
  "running"
] as const;

export type OpenCodeToolStateStatus = typeof OPENCODE_TOOL_STATE_STATUSES[number];

export const OPENCODE_SESSION_STATUS_TYPES = [
  "busy",
  "idle",
  "retry"
] as const;

export type OpenCodeSessionStatusType = typeof OPENCODE_SESSION_STATUS_TYPES[number];
