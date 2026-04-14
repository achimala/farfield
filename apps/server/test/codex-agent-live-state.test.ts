import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IpcResponseFrameSchema,
  ThreadConversationRequestSchema,
  parseIpcFrame,
  parseThreadConversationState,
  parseThreadStreamStateChangedBroadcast,
  type AppServerListThreadsResponse,
  type AppServerReadThreadResponse,
  type IpcFrame,
  type ThreadConversationRequest,
  type ThreadConversationState,
  type UserInputRequestId,
} from "@farfield/protocol";
import type {
  SendRequestOptions,
  SubmitCommandApprovalInput,
} from "@farfield/api";

const frameListeners: Array<(frame: IpcFrame) => void> = [];
const connectionListeners: Array<
  (state: { connected: boolean; reason?: string }) => void
> = [];
const commandApprovalCalls: SubmitCommandApprovalInput[] = [];

let readThreadResponse: AppServerReadThreadResponse;
let listThreadsResponse: AppServerListThreadsResponse;

vi.mock("@farfield/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@farfield/api")>();

  class MockAppServerClient {
    public constructor(_options: object) {}

    public async close(): Promise<void> {}

    public setIncomingMessageHandler(
      _handler: ((message: object) => void) | null,
    ): void {}

    public async listThreads(
      _options: object,
    ): Promise<AppServerListThreadsResponse> {
      return listThreadsResponse;
    }

    public async listLoadedThreads(_options: object): Promise<{
      data: string[];
      nextCursor: string | null;
    }> {
      return {
        data: [readThreadResponse.thread.id],
        nextCursor: null,
      };
    }

    public async readThread(
      _threadId: string,
      _includeTurns = true,
    ): Promise<AppServerReadThreadResponse> {
      return readThreadResponse;
    }

    public async resumeThread(
      threadId: string,
      _options: { persistExtendedHistory: boolean },
    ): Promise<AppServerReadThreadResponse> {
      return {
        thread: {
          ...readThreadResponse.thread,
          id: threadId,
        },
      };
    }

    public async submitUserInput(
      _requestId: UserInputRequestId,
      _response: object,
    ): Promise<void> {}
  }

  class MockDesktopIpcClient {
    private connected = false;

    public constructor(_options: object) {}

    public onFrame(listener: (frame: IpcFrame) => void): () => void {
      frameListeners.push(listener);
      return () => {
        const index = frameListeners.indexOf(listener);
        if (index >= 0) {
          frameListeners.splice(index, 1);
        }
      };
    }

    public onConnectionState(
      listener: (state: { connected: boolean; reason?: string }) => void,
    ): () => void {
      connectionListeners.push(listener);
      return () => {
        const index = connectionListeners.indexOf(listener);
        if (index >= 0) {
          connectionListeners.splice(index, 1);
        }
      };
    }

    public isConnected(): boolean {
      return this.connected;
    }

    public async connect(): Promise<void> {
      this.connected = true;
      for (const listener of connectionListeners) {
        listener({ connected: true });
      }
    }

    public async disconnect(): Promise<void> {
      this.connected = false;
      for (const listener of connectionListeners) {
        listener({ connected: false });
      }
    }

    public async initialize(_userAgent: string) {
      return IpcResponseFrameSchema.parse({
        type: "response",
        requestId: "initialize-1",
        method: "initialize",
        resultType: "success",
        result: {
          clientId: "client-1",
        },
      });
    }

    public async sendRequestAndWait(
      _method: string,
      _params: object,
      _options: SendRequestOptions = {},
    ) {
      return IpcResponseFrameSchema.parse({
        type: "response",
        requestId: "request-1",
        method: "ok",
        resultType: "success",
        result: {},
      });
    }
  }

  class MockCodexMonitorService {
    public constructor(_ipcClient: MockDesktopIpcClient) {}

    public async submitCommandApprovalDecision(
      input: SubmitCommandApprovalInput,
    ): Promise<void> {
      commandApprovalCalls.push(input);
    }

    public async submitFileApprovalDecision(_input: object): Promise<void> {}

    public async submitUserInput(_input: object): Promise<void> {}

    public async sendMessage(_input: object): Promise<void> {}

    public async setCollaborationMode(_input: object): Promise<void> {}

    public async interrupt(_input: object): Promise<void> {}
  }

  return {
    ...actual,
    AppServerClient: MockAppServerClient,
    DesktopIpcClient: MockDesktopIpcClient,
    CodexMonitorService: MockCodexMonitorService,
  };
});

import { CodexAgentAdapter } from "../src/agents/adapters/codex-agent.js";

function createThreadState(
  threadId: string,
  requests: ThreadConversationRequest[] = [],
): ThreadConversationState {
  return parseThreadConversationState({
    id: threadId,
    turns: [],
    requests,
  });
}

function createCommandApprovalRequest(
  threadId: string,
  requestId: UserInputRequestId,
): ThreadConversationRequest {
  return ThreadConversationRequestSchema.parse({
    id: requestId,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId,
      turnId: `turn-${String(requestId)}`,
      itemId: `item-${String(requestId)}`,
      command: "/bin/zsh -lc 'open -a Calculator'",
      reason: "Allow Calculator",
    },
  });
}

function createSnapshotEvent(
  threadId: string,
  state: ThreadConversationState,
  version: number,
): IpcFrame {
  return parseThreadStreamStateChangedBroadcast({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "client-1",
    version,
    params: {
      conversationId: threadId,
      type: "thread-stream-state-changed",
      version,
      change: {
        type: "snapshot",
        conversationState: state,
      },
    },
  });
}

function createApprovalPatchEvent(
  threadId: string,
  requestId: UserInputRequestId,
  version: number,
): IpcFrame {
  return parseThreadStreamStateChangedBroadcast({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "client-1",
    version,
    params: {
      conversationId: threadId,
      type: "thread-stream-state-changed",
      version,
      change: {
        type: "patches",
        patches: [
          {
            op: "add",
            path: ["requests", 0],
            value: createCommandApprovalRequest(threadId, requestId),
          },
        ],
      },
    },
  });
}

function createInformationalBroadcast(threadId: string): IpcFrame {
  return parseIpcFrame({
    type: "broadcast",
    method: "thread-read-state-changed",
    sourceClientId: "client-1",
    version: 1,
    params: {
      conversationId: threadId,
      hasUnreadTurn: false,
    },
  });
}

function createMalformedStreamBroadcast(threadId: string): IpcFrame {
  return parseIpcFrame({
    type: "broadcast",
    method: "thread-stream-state-changed",
    sourceClientId: "client-1",
    version: 1,
    params: {
      conversationId: threadId,
    },
  });
}

function emitFrame(frame: IpcFrame): void {
  for (const listener of frameListeners) {
    listener(frame);
  }
}

function createAdapter(): CodexAgentAdapter {
  return new CodexAgentAdapter({
    appExecutable: "codex",
    socketPath: "/tmp/codex.sock",
    workspaceDir: "/tmp/project",
    userAgent: "farfield-test",
    reconnectDelayMs: 10,
  });
}

describe("CodexAgentAdapter live state", () => {
  beforeEach(() => {
    frameListeners.splice(0, frameListeners.length);
    connectionListeners.splice(0, connectionListeners.length);
    commandApprovalCalls.splice(0, commandApprovalCalls.length);

    listThreadsResponse = {
      data: [],
      nextCursor: null,
    };
    readThreadResponse = {
      thread: createThreadState("thread-default"),
    };
  });

  it("ignores unrelated broadcasts when reducing live thread state", async () => {
    const threadId = "thread-mixed-stream";
    const adapter = createAdapter();

    await adapter.start();
    emitFrame(createSnapshotEvent(threadId, createThreadState(threadId), 1));
    emitFrame(createInformationalBroadcast(threadId));
    emitFrame(createApprovalPatchEvent(threadId, 41, 2));

    const liveState = await adapter.readLiveState(threadId);

    expect(liveState.liveStateError).toBeNull();
    expect(liveState.conversationState?.requests).toHaveLength(1);
    expect(liveState.conversationState?.requests[0]?.id).toBe(41);
    expect(liveState.conversationState?.requests[0]?.method).toBe(
      "item/commandExecution/requestApproval",
    );

    await adapter.stop();
  });

  it("keeps repeated approvals actionable in the same thread", async () => {
    const threadId = "thread-repeated-approvals";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    await adapter.start();
    emitFrame(createSnapshotEvent(threadId, createThreadState(threadId), 1));
    emitFrame(createApprovalPatchEvent(threadId, 0, 2));

    const firstLiveState = await adapter.readLiveState(threadId);
    expect(firstLiveState.liveStateError).toBeNull();
    expect(firstLiveState.conversationState?.requests[0]?.id).toBe(0);

    await adapter.submitUserInput({
      threadId,
      requestId: 0,
      response: {
        decision: "accept",
      },
    });

    expect(commandApprovalCalls).toHaveLength(1);
    expect(commandApprovalCalls[0]?.threadId).toBe(threadId);
    expect(commandApprovalCalls[0]?.requestId).toBe(0);

    emitFrame(createSnapshotEvent(threadId, createThreadState(threadId), 3));
    emitFrame(createInformationalBroadcast(threadId));
    emitFrame(createApprovalPatchEvent(threadId, 1, 4));

    const secondLiveState = await adapter.readLiveState(threadId);
    expect(secondLiveState.liveStateError).toBeNull();
    expect(secondLiveState.conversationState?.requests).toHaveLength(1);
    expect(secondLiveState.conversationState?.requests[0]?.id).toBe(1);

    await adapter.submitUserInput({
      threadId,
      requestId: 1,
      response: {
        decision: "accept",
      },
    });

    expect(commandApprovalCalls).toHaveLength(2);
    expect(commandApprovalCalls[1]?.threadId).toBe(threadId);
    expect(commandApprovalCalls[1]?.requestId).toBe(1);

    await adapter.stop();
  });

  it("prefers live thread state over stale readThread data for pending approvals", async () => {
    const threadId = "thread-read-thread-overlay";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: parseThreadConversationState({
        id: threadId,
        turns: [
          {
            id: "turn-stale",
            status: "interrupted",
            items: [
              {
                id: "item-user",
                type: "userMessage",
                content: [{ type: "text", text: "open calculator" }],
              },
            ],
          },
        ],
        requests: [],
      }),
    };

    await adapter.start();
    emitFrame(
      createSnapshotEvent(
        threadId,
        parseThreadConversationState({
          id: threadId,
          turns: [
            {
              id: "turn-stale",
              status: "inProgress",
              items: [
                {
                  id: "item-user",
                  type: "userMessage",
                  content: [{ type: "text", text: "open calculator" }],
                },
                {
                  id: "item-agent",
                  type: "agentMessage",
                  text: "Opening Calculator now.",
                },
              ],
            },
          ],
          requests: [],
        }),
        1,
      ),
    );
    emitFrame(createMalformedStreamBroadcast(threadId));
    emitFrame(createInformationalBroadcast(threadId));
    emitFrame(createApprovalPatchEvent(threadId, 7, 2));

    const result = await adapter.readThread({
      threadId,
      includeTurns: true,
    });

    expect(result.thread.requests).toHaveLength(1);
    expect(result.thread.requests[0]?.id).toBe(7);
    expect(result.thread.turns.at(-1)?.status).toBe("inProgress");
    expect(result.thread.turns.at(-1)?.items).toHaveLength(2);

    await adapter.stop();
  });

  it("still reports parse failures for malformed thread stream events", async () => {
    const threadId = "thread-malformed-stream";
    const adapter = createAdapter();

    await adapter.start();
    emitFrame(createSnapshotEvent(threadId, createThreadState(threadId), 1));
    emitFrame(createMalformedStreamBroadcast(threadId));
    emitFrame(createApprovalPatchEvent(threadId, 17, 2));

    const liveState = await adapter.readLiveState(threadId);

    expect(liveState.liveStateError?.kind).toBe("parseFailed");
    expect(liveState.liveStateError?.eventIndex).toBe(1);
    expect(liveState.conversationState?.requests).toHaveLength(1);
    expect(liveState.conversationState?.requests[0]?.id).toBe(17);

    await adapter.stop();
  });
});
