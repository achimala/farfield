// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/stable/json/ClientRequest.json
// Source: vendor/codex-app-server-schema/stable/json/ClientNotification.json
// Source: vendor/codex-app-server-schema/stable/json/ServerRequest.json
// Source: vendor/codex-app-server-schema/stable/json/ServerNotification.json

export const APP_SERVER_CLIENT_REQUEST_METHODS = [
  "account/login/cancel",
  "account/login/start",
  "account/logout",
  "account/rateLimits/read",
  "account/read",
  "addConversationListener",
  "app/list",
  "archiveConversation",
  "cancelLoginChatGpt",
  "command/exec",
  "config/batchWrite",
  "config/mcpServer/reload",
  "config/read",
  "config/value/write",
  "configRequirements/read",
  "execOneOffCommand",
  "experimentalFeature/list",
  "feedback/upload",
  "forkConversation",
  "fuzzyFileSearch",
  "getAuthStatus",
  "getConversationSummary",
  "getUserAgent",
  "getUserSavedConfig",
  "gitDiffToRemote",
  "initialize",
  "interruptConversation",
  "listConversations",
  "loginApiKey",
  "loginChatGpt",
  "logoutChatGpt",
  "mcpServer/oauth/login",
  "mcpServerStatus/list",
  "model/list",
  "newConversation",
  "removeConversationListener",
  "resumeConversation",
  "review/start",
  "sendUserMessage",
  "sendUserTurn",
  "setDefaultModel",
  "skills/config/write",
  "skills/list",
  "skills/remote/export",
  "skills/remote/list",
  "thread/archive",
  "thread/compact/start",
  "thread/fork",
  "thread/list",
  "thread/loaded/list",
  "thread/name/set",
  "thread/read",
  "thread/resume",
  "thread/rollback",
  "thread/start",
  "thread/unarchive",
  "turn/interrupt",
  "turn/start",
  "turn/steer",
  "userInfo"
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
  "authStatusChange",
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
  "loginChatGptComplete",
  "mcpServer/oauthLogin/completed",
  "model/rerouted",
  "rawResponseItem/completed",
  "sessionConfigured",
  "thread/archived",
  "thread/compacted",
  "thread/name/updated",
  "thread/started",
  "thread/tokenUsage/updated",
  "thread/unarchived",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "turn/started",
  "windows/worldWritableWarning"
] as const;

export type AppServerServerNotificationMethod =
  typeof APP_SERVER_SERVER_NOTIFICATION_METHODS[number];
