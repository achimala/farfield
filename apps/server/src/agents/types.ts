import type {
  AppServerCollaborationModeListResponse,
  AppServerListModelsResponse,
  AppServerListThreadsResponse,
  AppServerReadThreadResponse,
  AppServerStartThreadResponse,
  CollaborationMode,
  IpcFrame,
  UserInputRequestId,
  UserInputResponsePayload
} from "@farfield/protocol";

export type AgentId = "codex" | "opencode";

export interface AgentCapabilities {
  canListModels: boolean;
  canListCollaborationModes: boolean;
  canSetCollaborationMode: boolean;
  canSubmitUserInput: boolean;
  canReadLiveState: boolean;
  canReadStreamEvents: boolean;
}

export interface AgentListThreadsInput {
  limit: number;
  archived: boolean;
  all: boolean;
  maxPages: number;
  cursor: string | null;
}

export interface AgentCreateThreadInput {
  cwd?: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  sandbox?: string;
  approvalPolicy?: string;
  ephemeral?: boolean;
}

export type AgentThreadListItem = AppServerListThreadsResponse["data"][number];

export interface AgentListThreadsResult {
  data: AgentThreadListItem[];
  nextCursor: string | null;
  pages?: number;
  truncated?: boolean;
}

export interface AgentCreateThreadResult {
  threadId: string;
  thread: AppServerStartThreadResponse["thread"];
  model?: AppServerStartThreadResponse["model"];
  modelProvider?: AppServerStartThreadResponse["modelProvider"];
  cwd?: AppServerStartThreadResponse["cwd"];
  approvalPolicy?: AppServerStartThreadResponse["approvalPolicy"];
  sandbox?: AppServerStartThreadResponse["sandbox"];
  reasoningEffort?: AppServerStartThreadResponse["reasoningEffort"];
}

export interface AgentReadThreadResult {
  thread: AppServerReadThreadResponse["thread"];
}

export interface AgentReadThreadInput {
  threadId: string;
  includeTurns: boolean;
}

export interface AgentSendMessageInput {
  threadId: string;
  text: string;
  ownerClientId?: string;
  cwd?: string;
  isSteering?: boolean;
}

export interface AgentSetCollaborationModeInput {
  threadId: string;
  ownerClientId?: string;
  collaborationMode: CollaborationMode;
}

export interface AgentSubmitUserInputInput {
  threadId: string;
  ownerClientId?: string;
  requestId: UserInputRequestId;
  response: UserInputResponsePayload;
}

export interface AgentInterruptInput {
  threadId: string;
  ownerClientId?: string;
}

export interface AgentThreadLiveState {
  ownerClientId: string | null;
  conversationState: AppServerReadThreadResponse["thread"] | null;
  liveStateError: {
    kind: "reductionFailed";
    message: string;
    eventIndex: number | null;
    patchIndex: number | null;
  } | null;
}

export interface AgentThreadStreamEvents {
  ownerClientId: string | null;
  events: IpcFrame[];
}

export interface AgentDescriptor {
  id: AgentId;
  label: string;
  enabled: boolean;
  connected: boolean;
  capabilities: AgentCapabilities;
  projectDirectories: string[];
  projectLabels: Record<string, string>;
}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly label: string;
  readonly capabilities: AgentCapabilities;

  start(): Promise<void>;
  stop(): Promise<void>;
  isEnabled(): boolean;
  isConnected(): boolean;

  listThreads(input: AgentListThreadsInput): Promise<AgentListThreadsResult>;
  createThread(input: AgentCreateThreadInput): Promise<AgentCreateThreadResult>;
  readThread(input: AgentReadThreadInput): Promise<AgentReadThreadResult>;
  sendMessage(input: AgentSendMessageInput): Promise<void>;
  interrupt(input: AgentInterruptInput): Promise<void>;

  listModels?(limit: number): Promise<AppServerListModelsResponse>;
  listCollaborationModes?(): Promise<AppServerCollaborationModeListResponse>;
  setCollaborationMode?(input: AgentSetCollaborationModeInput): Promise<{ ownerClientId: string }>;
  submitUserInput?(
    input: AgentSubmitUserInputInput
  ): Promise<{ ownerClientId: string; requestId: UserInputRequestId }>;
  readLiveState?(threadId: string): Promise<AgentThreadLiveState>;
  readStreamEvents?(threadId: string, limit: number): Promise<AgentThreadStreamEvents>;
  listProjectDirectories?(): Promise<string[]>;
}
