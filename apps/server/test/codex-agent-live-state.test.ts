import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppServerServerRequestSchema,
  IpcResponseFrameSchema,
  ThreadConversationRequestSchema,
  parseThreadConversationState,
  type AppServerListThreadsResponse,
  type AppServerReadThreadResponse,
  type AppServerServerRequest,
  type IpcFrame,
  type ThreadConversationRequest,
  type ThreadConversationState,
  type TurnStartParams,
  type UserInputRequestId,
} from "@farfield/protocol";
import type {
  AppServerNotificationListener,
  AppServerRequestListener,
  SendRequestOptions,
} from "@farfield/api";

const frameListeners: Array<(frame: IpcFrame) => void> = [];
const connectionListeners: Array<
  (state: { connected: boolean; reason?: string }) => void
> = [];
const serverRequestListeners: AppServerRequestListener[] = [];
const serverNotificationListeners: AppServerNotificationListener[] = [];
const submitUserInputCalls: UserInputRequestId[] = [];
const startTurnCalls: TurnStartParams[] = [];
const ipcRequestCalls: Array<{
  method: string;
  params: object;
  options: SendRequestOptions;
}> = [];
const readThreadCalls: string[] = [];

let readThreadResponse: AppServerReadThreadResponse;
let listThreadsResponse: AppServerListThreadsResponse;

vi.mock("@farfield/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@farfield/api")>();

  class MockAppServerClient {
    public constructor(_options: object) {}

    public async close(): Promise<void> {}

    public onServerNotification(
      listener: AppServerNotificationListener,
    ): () => void {
      serverNotificationListeners.push(listener);
      return () => {
        const index = serverNotificationListeners.indexOf(listener);
        if (index >= 0) {
          serverNotificationListeners.splice(index, 1);
        }
      };
    }

    public onServerRequest(listener: AppServerRequestListener): () => void {
      serverRequestListeners.push(listener);
      return () => {
        const index = serverRequestListeners.indexOf(listener);
        if (index >= 0) {
          serverRequestListeners.splice(index, 1);
        }
      };
    }

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
      threadId: string,
      _includeTurns = true,
    ): Promise<AppServerReadThreadResponse> {
      readThreadCalls.push(threadId);
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
      requestId: UserInputRequestId,
      _response: object,
    ): Promise<void> {
      submitUserInputCalls.push(requestId);
    }

    public async startTurn(params: TurnStartParams): Promise<void> {
      startTurnCalls.push(params);
    }
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
      method: string,
      params: object,
      options: SendRequestOptions = {},
    ) {
      ipcRequestCalls.push({ method, params, options });
      return IpcResponseFrameSchema.parse({
        type: "response",
        requestId: "request-1",
        method: "ok",
        resultType: "success",
        result: {},
      });
    }
  }

  return {
    ...actual,
    AppServerClient: MockAppServerClient,
    DesktopIpcClient: MockDesktopIpcClient,
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
  completed = false,
): AppServerServerRequest {
  return AppServerServerRequestSchema.parse(
    ThreadConversationRequestSchema.parse({
      id: requestId,
      method: "item/commandExecution/requestApproval",
      completed,
      params: {
        threadId,
        turnId: `turn-${String(requestId)}`,
        itemId: `item-${String(requestId)}`,
        command: "/bin/zsh -lc 'open -a Calculator'",
        reason: "Allow Calculator",
      },
    }),
  );
}

function createLegacyExecCommandApprovalRequest(
  threadId: string,
  requestId: UserInputRequestId,
): AppServerServerRequest {
  return AppServerServerRequestSchema.parse(
    ThreadConversationRequestSchema.parse({
      id: requestId,
      method: "execCommandApproval",
      params: {
        conversationId: threadId,
        callId: `call-${String(requestId)}`,
        approvalId: `approval-${String(requestId)}`,
        command: ["echo", "hello"],
        cwd: "/tmp/project",
        parsedCmd: [],
        reason: "Allow echo",
      },
    }),
  );
}

function emitServerRequest(request: AppServerServerRequest): void {
  for (const listener of serverRequestListeners) {
    listener(request);
  }
}

function emitIpcFrame(frame: IpcFrame): void {
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

describe("CodexAgentAdapter app-server pending requests", () => {
  beforeEach(() => {
    frameListeners.splice(0, frameListeners.length);
    connectionListeners.splice(0, connectionListeners.length);
    serverRequestListeners.splice(0, serverRequestListeners.length);
    serverNotificationListeners.splice(0, serverNotificationListeners.length);
    submitUserInputCalls.splice(0, submitUserInputCalls.length);
    startTurnCalls.splice(0, startTurnCalls.length);
    ipcRequestCalls.splice(0, ipcRequestCalls.length);
    readThreadCalls.splice(0, readThreadCalls.length);

    listThreadsResponse = {
      data: [],
      nextCursor: null,
    };
    readThreadResponse = {
      thread: createThreadState("thread-default"),
    };
  });

  it("routes owned thread sends through the desktop follower client", async () => {
    const threadId = "thread-owned-send";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };
    await adapter.start();

    await adapter.sendMessage({
      threadId,
      ownerClientId: "client-1",
      text: "hello from Farfield",
      model: "gpt-5.5",
    });

    expect(startTurnCalls).toEqual([]);
    expect(ipcRequestCalls).toContainEqual({
      method: "thread-follower-start-turn",
      params: {
        conversationId: threadId,
        turnStartParams: {
          threadId,
          input: [{ type: "text", text: "hello from Farfield" }],
          model: "gpt-5.5",
          attachments: [],
        },
        isSteering: false,
      },
      options: {
        targetClientId: "client-1",
        version: 1,
      },
    });
  });

  it("uses app-server turn start when no owner client is known", async () => {
    const threadId = "thread-unowned-send";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };
    await adapter.start();

    await adapter.sendMessage({
      threadId,
      text: "hello from Farfield",
      model: "gpt-5.5",
    });

    expect(ipcRequestCalls).toEqual([]);
    expect(startTurnCalls).toEqual([
      {
        threadId,
        input: [{ type: "text", text: "hello from Farfield" }],
        model: "gpt-5.5",
        attachments: [],
      },
    ]);
  });

  it("returns canonical thread state for sparse readThread results", async () => {
    const threadId = "thread-canonical-read";
    const adapter = createAdapter();
    const canonicalThread = parseThreadConversationState({
      id: threadId,
      turns: [
        {
          id: "019dcd42-5591-7100-bfe7-3d14f7d22182",
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [{ type: "text", text: "Earlier canonical turn" }],
            },
          ],
        },
      ],
      requests: [],
    });
    readThreadResponse = {
      thread: createThreadState(threadId),
    };
    await adapter.start();

    emitIpcFrame({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "owner-1",
      version: 6,
      params: {
        conversationId: threadId,
        type: "thread-stream-state-changed",
        version: 6,
        change: {
          type: "snapshot",
          conversationState: canonicalThread,
        },
      },
    });

    const result = await adapter.readThread({
      threadId,
      includeTurns: false,
    });

    expect(result.thread.turns.map((turn) => turn.id)).toEqual([
      "019dcd42-5591-7100-bfe7-3d14f7d22182",
    ]);
  });

  it("routes owned collaboration mode changes through the desktop follower client", async () => {
    const threadId = "thread-owned-mode";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };
    await adapter.start();

    const result = await adapter.setCollaborationMode({
      threadId,
      ownerClientId: "client-1",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "high",
          developer_instructions: "plan carefully",
        },
      },
    });

    expect(result.ownerClientId).toBe("client-1");
    expect(ipcRequestCalls).toContainEqual({
      method: "thread-follower-set-model-and-reasoning",
      params: {
        conversationId: threadId,
        model: "gpt-5.5",
        reasoningEffort: "high",
      },
      options: {
        targetClientId: "client-1",
        version: 1,
        timeoutMs: 5_000,
      },
    });
    expect(ipcRequestCalls).toContainEqual({
      method: "thread-follower-set-collaboration-mode",
      params: {
        conversationId: threadId,
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.5",
            reasoning_effort: "high",
            developer_instructions: "plan carefully",
          },
        },
      },
      options: {
        targetClientId: "client-1",
        version: 1,
        timeoutMs: 5_000,
      },
    });
  });

  it("keeps unowned collaboration mode changes local", async () => {
    const threadId = "thread-unowned-mode";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };
    await adapter.start();

    const result = await adapter.setCollaborationMode({
      threadId,
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.5",
          reasoning_effort: "medium",
        },
      },
    });

    expect(result.ownerClientId).toBe("farfield");
    expect(ipcRequestCalls).toEqual([]);
  });

  it("merges pending app-server requests into readThread results", async () => {
    const threadId = "thread-app-server-pending";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    emitServerRequest(createCommandApprovalRequest(threadId, 41));

    const result = await adapter.readThread({
      threadId,
      includeTurns: true,
    });

    expect(result.thread.requests).toHaveLength(1);
    expect(result.thread.requests[0]?.id).toBe(41);
    expect(result.thread.requests[0]?.method).toBe(
      "item/commandExecution/requestApproval",
    );
  });

  it("submits pending app-server requests even before readThread includes them", async () => {
    const threadId = "thread-submit-app-server-pending";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    emitServerRequest(createCommandApprovalRequest(threadId, 7));

    await adapter.submitUserInput({
      threadId,
      requestId: 7,
      response: { decision: "accept" },
    });

    expect(submitUserInputCalls).toEqual([]);
    expect(ipcRequestCalls).toEqual([
      {
        method: "thread-follower-command-approval-decision",
        params: {
          conversationId: threadId,
          requestId: 7,
          decision: "accept",
        },
        options: {
          version: 1,
        },
      },
    ]);

    const result = await adapter.readThread({
      threadId,
      includeTurns: true,
    });
    expect(result.thread.requests).toHaveLength(0);
  });

  it("submits app-server request ids even when readThread omits the request", async () => {
    const threadId = "thread-submit-request-id-directly";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    await adapter.submitUserInput({
      threadId,
      requestId: 11,
      response: { decision: "decline" },
    });

    expect(submitUserInputCalls).toEqual([11]);
    expect(readThreadCalls).toEqual([]);
  });

  it("removes cached pending requests when app-server marks them complete", async () => {
    const threadId = "thread-completed-app-server-request";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    emitServerRequest(createCommandApprovalRequest(threadId, 9));
    expect(
      (
        await adapter.readThread({
          threadId,
          includeTurns: true,
        })
      ).thread.requests,
    ).toHaveLength(1);

    emitServerRequest(createCommandApprovalRequest(threadId, 9, true));

    const result = await adapter.readThread({
      threadId,
      includeTurns: true,
    });
    expect(result.thread.requests).toHaveLength(0);
  });

  it("routes legacy app-server approval requests by conversationId", async () => {
    const threadId = "thread-legacy-request";
    const adapter = createAdapter();
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    emitServerRequest(createLegacyExecCommandApprovalRequest(threadId, 15));

    expect(readThreadCalls).toContain(threadId);

    const result = await adapter.readThread({
      threadId,
      includeTurns: true,
    });
    expect(result.thread.requests).toHaveLength(1);
    expect(result.thread.requests[0]?.method).toBe("execCommandApproval");
  });

  it("evicts cached requests after an authoritative read stops listing them", async () => {
    const threadId = "thread-authoritative-request-eviction";
    const adapter = createAdapter();
    const request = ThreadConversationRequestSchema.parse(
      createCommandApprovalRequest(threadId, 17),
    );
    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    emitServerRequest(createCommandApprovalRequest(threadId, 17));
    expect(
      (
        await adapter.readThread({
          threadId,
          includeTurns: true,
        })
      ).thread.requests,
    ).toHaveLength(1);

    readThreadResponse = {
      thread: createThreadState(threadId, [request]),
    };
    expect(
      (
        await adapter.readThread({
          threadId,
          includeTurns: true,
        })
      ).thread.requests,
    ).toHaveLength(1);

    readThreadResponse = {
      thread: createThreadState(threadId),
    };

    const result = await adapter.readThread({
      threadId,
      includeTurns: true,
    });
    expect(result.thread.requests).toHaveLength(0);
  });
});
