import type {
  AppServerClientNotificationMethod,
  AppServerClientRequestMethod,
  AppServerServerNotificationMethod,
  AppServerServerRequestMethod
} from "@farfield/protocol";
import type { UnifiedCommandKind, UnifiedEventKind } from "@farfield/unified-surface";

export type CodexClientMethodMapping =
  | {
      status: "exposed";
      commandKind: UnifiedCommandKind;
    }
  | {
      status: "internal";
    };

export type CodexEventMethodMapping =
  | {
      status: "exposed";
      eventKind: UnifiedEventKind;
    }
  | {
      status: "internal";
    };

export const CODEX_CLIENT_REQUEST_METHOD_MAP: Record<
  AppServerClientRequestMethod,
  CodexClientMethodMapping
> = {
  "account/login/cancel": { status: "internal" },
  "account/login/start": { status: "internal" },
  "account/logout": { status: "internal" },
  "account/rateLimits/read": { status: "internal" },
  "account/read": { status: "internal" },
  "app/list": { status: "internal" },
  "collaborationMode/list": { status: "exposed", commandKind: "listCollaborationModes" },
  "command/exec": { status: "internal" },
  "config/batchWrite": { status: "internal" },
  "config/mcpServer/reload": { status: "internal" },
  "config/read": { status: "internal" },
  "config/value/write": { status: "internal" },
  "configRequirements/read": { status: "internal" },
  "experimentalFeature/list": { status: "internal" },
  "externalAgentConfig/detect": { status: "internal" },
  "externalAgentConfig/import": { status: "internal" },
  "feedback/upload": { status: "internal" },
  fuzzyFileSearch: { status: "internal" },
  "fuzzyFileSearch/sessionStart": { status: "internal" },
  "fuzzyFileSearch/sessionStop": { status: "internal" },
  "fuzzyFileSearch/sessionUpdate": { status: "internal" },
  initialize: { status: "internal" },
  "mcpServer/oauth/login": { status: "internal" },
  "mcpServerStatus/list": { status: "internal" },
  "mock/experimentalMethod": { status: "internal" },
  "model/list": { status: "exposed", commandKind: "listModels" },
  "review/start": { status: "internal" },
  "skills/config/write": { status: "internal" },
  "skills/list": { status: "internal" },
  "skills/remote/export": { status: "internal" },
  "skills/remote/list": { status: "internal" },
  "thread/archive": { status: "internal" },
  "thread/backgroundTerminals/clean": { status: "internal" },
  "thread/compact/start": { status: "internal" },
  "thread/fork": { status: "internal" },
  "thread/list": { status: "exposed", commandKind: "listThreads" },
  "thread/loaded/list": { status: "internal" },
  "thread/name/set": { status: "internal" },
  "thread/read": { status: "exposed", commandKind: "readThread" },
  "thread/realtime/appendAudio": { status: "internal" },
  "thread/realtime/appendText": { status: "internal" },
  "thread/realtime/start": { status: "internal" },
  "thread/realtime/stop": { status: "internal" },
  "thread/resume": { status: "internal" },
  "thread/rollback": { status: "internal" },
  "thread/start": { status: "exposed", commandKind: "createThread" },
  "thread/unarchive": { status: "internal" },
  "thread/unsubscribe": { status: "internal" },
  "turn/interrupt": { status: "exposed", commandKind: "interrupt" },
  "turn/start": { status: "exposed", commandKind: "sendMessage" },
  "turn/steer": { status: "exposed", commandKind: "sendMessage" },
  "windowsSandbox/setupStart": { status: "internal" }
};

export const CODEX_CLIENT_NOTIFICATION_METHOD_MAP: Record<
  AppServerClientNotificationMethod,
  CodexEventMethodMapping
> = {
  initialized: { status: "exposed", eventKind: "providerStateChanged" }
};

export const CODEX_SERVER_REQUEST_METHOD_MAP: Record<
  AppServerServerRequestMethod,
  CodexEventMethodMapping
> = {
  "account/chatgptAuthTokens/refresh": { status: "exposed", eventKind: "providerStateChanged" },
  applyPatchApproval: { status: "exposed", eventKind: "userInputRequested" },
  execCommandApproval: { status: "exposed", eventKind: "userInputRequested" },
  "item/commandExecution/requestApproval": { status: "exposed", eventKind: "userInputRequested" },
  "item/fileChange/requestApproval": { status: "exposed", eventKind: "userInputRequested" },
  "item/tool/call": { status: "internal" },
  "item/tool/requestUserInput": { status: "exposed", eventKind: "userInputRequested" }
};

export const CODEX_SERVER_NOTIFICATION_METHOD_MAP: Record<
  AppServerServerNotificationMethod,
  CodexEventMethodMapping
> = {
  "account/login/completed": { status: "exposed", eventKind: "providerStateChanged" },
  "account/rateLimits/updated": { status: "exposed", eventKind: "providerStateChanged" },
  "account/updated": { status: "exposed", eventKind: "providerStateChanged" },
  "app/list/updated": { status: "exposed", eventKind: "providerStateChanged" },
  configWarning: { status: "exposed", eventKind: "error" },
  deprecationNotice: { status: "exposed", eventKind: "error" },
  error: { status: "exposed", eventKind: "error" },
  "fuzzyFileSearch/sessionCompleted": { status: "internal" },
  "fuzzyFileSearch/sessionUpdated": { status: "internal" },
  "item/agentMessage/delta": { status: "exposed", eventKind: "threadUpdated" },
  "item/commandExecution/outputDelta": { status: "exposed", eventKind: "threadUpdated" },
  "item/commandExecution/terminalInteraction": { status: "exposed", eventKind: "threadUpdated" },
  "item/completed": { status: "exposed", eventKind: "threadUpdated" },
  "item/fileChange/outputDelta": { status: "exposed", eventKind: "threadUpdated" },
  "item/mcpToolCall/progress": { status: "exposed", eventKind: "threadUpdated" },
  "item/plan/delta": { status: "exposed", eventKind: "threadUpdated" },
  "item/reasoning/summaryPartAdded": { status: "exposed", eventKind: "threadUpdated" },
  "item/reasoning/summaryTextDelta": { status: "exposed", eventKind: "threadUpdated" },
  "item/reasoning/textDelta": { status: "exposed", eventKind: "threadUpdated" },
  "item/started": { status: "exposed", eventKind: "threadUpdated" },
  "mcpServer/oauthLogin/completed": { status: "exposed", eventKind: "providerStateChanged" },
  "model/rerouted": { status: "exposed", eventKind: "threadUpdated" },
  "thread/archived": { status: "exposed", eventKind: "threadUpdated" },
  "thread/closed": { status: "exposed", eventKind: "threadUpdated" },
  "thread/compacted": { status: "exposed", eventKind: "threadUpdated" },
  "thread/name/updated": { status: "exposed", eventKind: "threadUpdated" },
  "thread/realtime/closed": { status: "exposed", eventKind: "threadUpdated" },
  "thread/realtime/error": { status: "exposed", eventKind: "error" },
  "thread/realtime/itemAdded": { status: "exposed", eventKind: "threadUpdated" },
  "thread/realtime/outputAudio/delta": { status: "exposed", eventKind: "threadUpdated" },
  "thread/realtime/started": { status: "exposed", eventKind: "threadUpdated" },
  "thread/started": { status: "exposed", eventKind: "threadUpdated" },
  "thread/status/changed": { status: "exposed", eventKind: "threadUpdated" },
  "thread/tokenUsage/updated": { status: "exposed", eventKind: "threadUpdated" },
  "thread/unarchived": { status: "exposed", eventKind: "threadUpdated" },
  "turn/completed": { status: "exposed", eventKind: "threadUpdated" },
  "turn/diff/updated": { status: "exposed", eventKind: "threadUpdated" },
  "turn/plan/updated": { status: "exposed", eventKind: "threadUpdated" },
  "turn/started": { status: "exposed", eventKind: "threadUpdated" },
  "windows/worldWritableWarning": { status: "exposed", eventKind: "error" },
  "windowsSandbox/setupCompleted": {
    status: "exposed",
    eventKind: "providerStateChanged"
  }
};

export function getCodexClientRequestMethodMapping(
  method: AppServerClientRequestMethod
): CodexClientMethodMapping {
  const mapping = CODEX_CLIENT_REQUEST_METHOD_MAP[method];
  if (!mapping) {
    throw new Error(`Missing client request method mapping for ${method}`);
  }
  return mapping;
}

export function getCodexClientNotificationMethodMapping(
  method: AppServerClientNotificationMethod
): CodexEventMethodMapping {
  const mapping = CODEX_CLIENT_NOTIFICATION_METHOD_MAP[method];
  if (!mapping) {
    throw new Error(`Missing client notification method mapping for ${method}`);
  }
  return mapping;
}

export function getCodexServerRequestMethodMapping(
  method: AppServerServerRequestMethod
): CodexEventMethodMapping {
  const mapping = CODEX_SERVER_REQUEST_METHOD_MAP[method];
  if (!mapping) {
    throw new Error(`Missing server request method mapping for ${method}`);
  }
  return mapping;
}

export function getCodexServerNotificationMethodMapping(
  method: AppServerServerNotificationMethod
): CodexEventMethodMapping {
  const mapping = CODEX_SERVER_NOTIFICATION_METHOD_MAP[method];
  if (!mapping) {
    throw new Error(`Missing server notification method mapping for ${method}`);
  }
  return mapping;
}

type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

type MissingClientRequestMethod = Exclude<
  AppServerClientRequestMethod,
  keyof typeof CODEX_CLIENT_REQUEST_METHOD_MAP
>;
type ExtraClientRequestMethod = Exclude<
  keyof typeof CODEX_CLIENT_REQUEST_METHOD_MAP,
  AppServerClientRequestMethod
>;
type MissingClientNotificationMethod = Exclude<
  AppServerClientNotificationMethod,
  keyof typeof CODEX_CLIENT_NOTIFICATION_METHOD_MAP
>;
type ExtraClientNotificationMethod = Exclude<
  keyof typeof CODEX_CLIENT_NOTIFICATION_METHOD_MAP,
  AppServerClientNotificationMethod
>;
type MissingServerRequestMethod = Exclude<
  AppServerServerRequestMethod,
  keyof typeof CODEX_SERVER_REQUEST_METHOD_MAP
>;
type ExtraServerRequestMethod = Exclude<
  keyof typeof CODEX_SERVER_REQUEST_METHOD_MAP,
  AppServerServerRequestMethod
>;
type MissingServerNotificationMethod = Exclude<
  AppServerServerNotificationMethod,
  keyof typeof CODEX_SERVER_NOTIFICATION_METHOD_MAP
>;
type ExtraServerNotificationMethod = Exclude<
  keyof typeof CODEX_SERVER_NOTIFICATION_METHOD_MAP,
  AppServerServerNotificationMethod
>;

type _AssertNoMissingClientRequestMethod = AssertTrue<IsNever<MissingClientRequestMethod>>;
type _AssertNoExtraClientRequestMethod = AssertTrue<IsNever<ExtraClientRequestMethod>>;
type _AssertNoMissingClientNotificationMethod = AssertTrue<IsNever<MissingClientNotificationMethod>>;
type _AssertNoExtraClientNotificationMethod = AssertTrue<IsNever<ExtraClientNotificationMethod>>;
type _AssertNoMissingServerRequestMethod = AssertTrue<IsNever<MissingServerRequestMethod>>;
type _AssertNoExtraServerRequestMethod = AssertTrue<IsNever<ExtraServerRequestMethod>>;
type _AssertNoMissingServerNotificationMethod = AssertTrue<IsNever<MissingServerNotificationMethod>>;
type _AssertNoExtraServerNotificationMethod = AssertTrue<IsNever<ExtraServerNotificationMethod>>;

void (
  {
    clientRequestMethods: CODEX_CLIENT_REQUEST_METHOD_MAP,
    clientNotificationMethods: CODEX_CLIENT_NOTIFICATION_METHOD_MAP,
    serverRequestMethods: CODEX_SERVER_REQUEST_METHOD_MAP,
    serverNotificationMethods: CODEX_SERVER_NOTIFICATION_METHOD_MAP
  }
);
