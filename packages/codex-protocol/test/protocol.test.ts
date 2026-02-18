import { describe, expect, it } from "vitest";
import {
  parseAppServerReadThreadResponse,
  parseAppServerListModelsResponse,
  parseAppServerCollaborationModeListResponse,
  parseAppServerStartThreadResponse,
  parseIpcFrame,
  parseThreadConversationState,
  parseThreadStreamStateChangedBroadcast,
  parseUserInputResponsePayload
} from "../src/index.js";

describe("codex-protocol schemas", () => {
  it("parses a valid thread stream patches broadcast", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 4,
      params: {
        conversationId: "thread-123",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "patches",
          patches: [
            {
              op: "add",
              path: ["requests", 0],
              value: {
                method: "item/tool/requestUserInput",
                id: 9,
                params: {
                  threadId: "thread-123",
                  turnId: "turn-123",
                  itemId: "item-123",
                  questions: [
                    {
                      id: "question_a",
                      header: "Scope",
                      question: "Choose one",
                      isOther: true,
                      isSecret: false,
                      options: [
                        {
                          label: "Option A",
                          description: "Description A"
                        }
                      ]
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    });

    expect(parsed.params.change.type).toBe("patches");
  });

  it("parses snapshot broadcast with null title and empty model defaults", () => {
    const parsed = parseThreadStreamStateChangedBroadcast({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "client-123",
      version: 4,
      params: {
        conversationId: "thread-123",
        type: "thread-stream-state-changed",
        version: 4,
        change: {
          type: "snapshot",
          conversationState: {
            id: "thread-123",
            turns: [],
            requests: [],
            createdAt: 1700000000,
            updatedAt: 1700000000,
            title: null,
            latestModel: "",
            latestReasoningEffort: null,
            previousTurnModel: null,
            latestCollaborationMode: {
              mode: "default",
              settings: {
                model: "",
                reasoning_effort: null,
                developer_instructions: null
              }
            },
            hasUnreadTurn: false,
            rolloutPath: "/tmp/rollout.jsonl",
            gitInfo: null,
            resumeState: "resumed",
            latestTokenUsageInfo: null,
            cwd: "/tmp/workspace",
            source: "vscode"
          }
        }
      }
    });

    expect(parsed.params.change.type).toBe("snapshot");
  });

  it("rejects invalid patch value for remove operation", () => {
    expect(() =>
      parseThreadStreamStateChangedBroadcast({
        type: "broadcast",
        method: "thread-stream-state-changed",
        sourceClientId: "client-123",
        version: 4,
        params: {
          conversationId: "thread-123",
          type: "thread-stream-state-changed",
          version: 4,
          change: {
            type: "patches",
            patches: [
              {
                op: "remove",
                path: ["requests", 0],
                value: true
              }
            ]
          }
        }
      })
    ).toThrowError(/remove patches must not include value/);
  });

  it("parses thread conversation state with userInputResponse item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          params: {
            threadId: "thread-123",
            input: [{ type: "text", text: "hello" }],
            attachments: []
          },
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userInputResponse",
              requestId: 12,
              turnId: "turn-1",
              questions: [{ id: "q", header: "H", question: "Q" }],
              answers: { q: ["A"] },
              completed: true
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("userInputResponse");
  });

  it("parses thread conversation state with mixed text and image user content", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-1",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text: "describe this image"
                },
                {
                  type: "image",
                  url: "data:image/png;base64,AAAA"
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("userMessage");
  });

  it("parses steering user message item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-steering",
              type: "steeringUserMessage",
              content: [
                {
                  type: "text",
                  text: "please keep this concise"
                }
              ],
              attachments: []
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("steeringUserMessage");
  });

  it("rejects thread conversation state with unknown item types", () => {
    expect(() =>
      parseThreadConversationState({
        id: "thread-123",
        turns: [
          {
            status: "completed",
            items: [
              {
                id: "item-unknown",
                type: "toolCall",
                payload: {
                  hello: "world"
                }
              }
            ]
          }
        ],
        requests: []
      })
    ).toThrowError(/ThreadConversationState did not match expected schema/);
  });

  it("parses thread conversation state with command execution item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-cmd",
              type: "commandExecution",
              command: "echo hello",
              cwd: "/tmp",
              processId: "123",
              status: "completed",
              commandActions: [
                {
                  type: "read",
                  command: "cat file.txt",
                  name: "file.txt",
                  path: "file.txt"
                }
              ],
              aggregatedOutput: "hello",
              exitCode: 0,
              durationMs: 5
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("commandExecution");
  });

  it("parses command action with null path and query", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-cmd",
              type: "commandExecution",
              command: "rg -n hello -S",
              status: "completed",
              commandActions: [
                {
                  type: "search",
                  command: "rg -n hello -S",
                  query: "hello",
                  path: null
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("commandExecution");
  });

  it("parses thread conversation state with fileChange item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-file",
              type: "fileChange",
              status: "completed",
              changes: [
                {
                  path: "/tmp/file.txt",
                  kind: {
                    type: "update",
                    move_path: null
                  },
                  diff: "@@ -1 +1 @@\n-old\n+new\n"
                }
              ]
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("fileChange");
  });

  it("parses thread conversation state with contextCompaction and webSearch items", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-compact",
              type: "contextCompaction",
              completed: true
            },
            {
              id: "item-web",
              type: "webSearch",
              query: "example query",
              action: {
                type: "search",
                query: "example query",
                queries: ["example query"]
              }
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("contextCompaction");
    expect(parsed.turns[0]?.items[1]?.type).toBe("webSearch");
  });

  it("parses thread conversation state with modelChanged item", () => {
    const parsed = parseThreadConversationState({
      id: "thread-123",
      turns: [
        {
          status: "completed",
          items: [
            {
              id: "item-model",
              type: "modelChanged",
              fromModel: "gpt-5.3-codex-spark",
              toModel: "gpt-5.3-codex"
            }
          ]
        }
      ],
      requests: []
    });

    expect(parsed.turns[0]?.items[0]?.type).toBe("modelChanged");
  });

  it("parses generic ipc request frames", () => {
    const parsed = parseIpcFrame({
      type: "request",
      requestId: "request-5",
      method: "thread-follower-start-turn",
      params: {
        conversationId: "thread-123"
      },
      version: 1,
      targetClientId: "client-1"
    });

    expect(parsed.type).toBe("request");
  });

  it("parses client discovery request frames", () => {
    const parsed = parseIpcFrame({
      type: "client-discovery-request",
      requestId: "discovery-1",
      request: {
        type: "request",
        requestId: "inner-1",
        sourceClientId: "desktop-client",
        version: 0,
        method: "ide-context",
        params: {
          workspaceRoot: "/tmp/workspace"
        }
      }
    });

    expect(parsed.type).toBe("client-discovery-request");
  });

  it("rejects malformed user input answer payload", () => {
    expect(() =>
      parseUserInputResponsePayload({
        answers: {
          q: {
            answers: [""]
          }
        }
      })
    ).toThrowError(/String must contain at least 1 character/);
  });

  it("parses collaboration mode list response", () => {
    const parsed = parseAppServerCollaborationModeListResponse({
      data: [
        {
          name: "Plan",
          mode: "plan",
          model: null,
          reasoning_effort: "medium",
          developer_instructions: "Instructions"
        }
      ]
    });

    expect(parsed.data[0]?.mode).toBe("plan");
  });

  it("parses app-server model/list response with modern model shape", () => {
    const parsed = parseAppServerListModelsResponse({
      data: [
        {
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          upgrade: null,
          displayName: "GPT-5.3 Codex",
          description: "Latest frontier agentic coding model.",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced"
            },
            {
              reasoningEffort: "xhigh",
              description: "Deep reasoning"
            }
          ],
          defaultReasoningEffort: "xhigh",
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          isDefault: true,
          hidden: true
        }
      ],
      nextCursor: null
    });

    expect(parsed.data[0]?.id).toBe("gpt-5.3-codex");
    expect(parsed.data[0]?.["hidden"]).toBe(true);
  });

  it("parses unknown top-level keys in app-server model/list response", () => {
    const parsed = parseAppServerListModelsResponse({
      data: [
        {
          id: "gpt-5.3-codex",
          model: "gpt-5.3-codex",
          upgrade: null,
          displayName: "GPT-5.3 Codex",
          description: "Latest frontier agentic coding model.",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "medium",
              description: "Balanced"
            }
          ],
          defaultReasoningEffort: "medium",
          inputModalities: ["text"],
          supportsPersonality: true,
          isDefault: true
        }
      ],
      nextCursor: null,
      hidden: true
    });

    expect(parsed["hidden"]).toBe(true);
  });

  it("parses app-server thread/read response with subset validation", () => {
    const parsed = parseAppServerReadThreadResponse({
      thread: {
        id: "thread-123",
        preview: "hello",
        modelProvider: "openai",
        path: "/tmp/thread.jsonl",
        cliVersion: "0.1.0",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [
              {
                id: "item-1",
                type: "agentMessage",
                text: "hello"
              }
            ]
          }
        ]
      }
    });

    expect(parsed.thread.id).toBe("thread-123");
    expect(parsed.thread.requests).toEqual([]);
    expect(parsed.thread.turns[0]?.status).toBe("completed");
  });

  it("parses app-server thread/start response", () => {
    const parsed = parseAppServerStartThreadResponse({
      thread: {
        id: "thread-456",
        preview: "",
        modelProvider: "openai",
        createdAt: 1700000000,
        updatedAt: 1700000000,
        cwd: "/tmp/workspace",
        path: "/tmp/rollout.jsonl",
        cliVersion: "0.1.0",
        source: "vscode",
        gitInfo: null,
        turns: []
      },
      model: "gpt-5.3-codex",
      modelProvider: "openai",
      cwd: "/tmp/workspace",
      approvalPolicy: "never",
      sandbox: {
        type: "dangerFullAccess"
      },
      reasoningEffort: "medium"
    });

    expect(parsed.thread.id).toBe("thread-456");
    expect(parsed.model).toBe("gpt-5.3-codex");
  });
});
