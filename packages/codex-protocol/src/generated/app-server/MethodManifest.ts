// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/stable/json/ClientRequest.json
// Source: vendor/codex-app-server-schema/experimental/json/ClientRequest.json
// Source: vendor/codex-app-server-schema/stable/json/ClientNotification.json
// Source: vendor/codex-app-server-schema/experimental/json/ClientNotification.json
// Source: vendor/codex-app-server-schema/stable/json/ServerRequest.json
// Source: vendor/codex-app-server-schema/experimental/json/ServerRequest.json
// Source: vendor/codex-app-server-schema/stable/json/ServerNotification.json
// Source: vendor/codex-app-server-schema/experimental/json/ServerNotification.json

export const APP_SERVER_CLIENT_REQUEST_METHODS = [
  "account/login/cancel",
  "account/login/start",
  "account/logout",
  "account/rateLimits/read",
  "account/read",
  "app/list",
  "collaborationMode/list",
  "command/exec",
  "config/batchWrite",
  "config/mcpServer/reload",
  "config/read",
  "config/value/write",
  "configRequirements/read",
  "experimentalFeature/list",
  "externalAgentConfig/detect",
  "externalAgentConfig/import",
  "feedback/upload",
  "fuzzyFileSearch",
  "fuzzyFileSearch/sessionStart",
  "fuzzyFileSearch/sessionStop",
  "fuzzyFileSearch/sessionUpdate",
  "initialize",
  "mcpServer/oauth/login",
  "mcpServerStatus/list",
  "mock/experimentalMethod",
  "model/list",
  "review/start",
  "skills/config/write",
  "skills/list",
  "skills/remote/export",
  "skills/remote/list",
  "thread/archive",
  "thread/backgroundTerminals/clean",
  "thread/compact/start",
  "thread/fork",
  "thread/list",
  "thread/loaded/list",
  "thread/name/set",
  "thread/read",
  "thread/realtime/appendAudio",
  "thread/realtime/appendText",
  "thread/realtime/start",
  "thread/realtime/stop",
  "thread/resume",
  "thread/rollback",
  "thread/start",
  "thread/unarchive",
  "thread/unsubscribe",
  "turn/interrupt",
  "turn/start",
  "turn/steer",
  "windowsSandbox/setupStart"
] as const;

export type AppServerClientRequestMethod =
  typeof APP_SERVER_CLIENT_REQUEST_METHODS[number];

export const APP_SERVER_CLIENT_NOTIFICATION_METHODS = [
  "initialized"
] as const;

export type AppServerClientNotificationMethod =
  typeof APP_SERVER_CLIENT_NOTIFICATION_METHODS[number];

export const APP_SERVER_SERVER_REQUEST_METHODS = [
  "account/chatgptAuthTokens/refresh",
  "applyPatchApproval",
  "execCommandApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/call",
  "item/tool/requestUserInput"
] as const;

export type AppServerServerRequestMethod =
  typeof APP_SERVER_SERVER_REQUEST_METHODS[number];

export const APP_SERVER_SERVER_NOTIFICATION_METHODS = [
  "account/login/completed",
  "account/rateLimits/updated",
  "account/updated",
  "app/list/updated",
  "configWarning",
  "deprecationNotice",
  "error",
  "fuzzyFileSearch/sessionCompleted",
  "fuzzyFileSearch/sessionUpdated",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/completed",
  "item/fileChange/outputDelta",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/started",
  "mcpServer/oauthLogin/completed",
  "model/rerouted",
  "thread/archived",
  "thread/closed",
  "thread/compacted",
  "thread/name/updated",
  "thread/realtime/closed",
  "thread/realtime/error",
  "thread/realtime/itemAdded",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/started",
  "thread/started",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "thread/unarchived",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "turn/started",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted"
] as const;

export type AppServerServerNotificationMethod =
  typeof APP_SERVER_SERVER_NOTIFICATION_METHODS[number];
