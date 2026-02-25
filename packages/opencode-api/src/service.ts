import type {
  Session,
  Message,
  Part,
  Project,
  Agent
} from "@opencode-ai/sdk";
import type { OpenCodeConnection } from "./client.js";
import {
  sessionToThreadListItem,
  sessionToConversationState,
  type MappedThreadListItem,
  type MappedThreadConversationState
} from "./mapper.js";

export interface OpenCodeSendMessageInput {
  sessionId: string;
  text: string;
  directory?: string;
  agent?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
}

export interface OpenCodeCreateSessionInput {
  title?: string;
  directory?: string;
}

export interface OpenCodeProviderModel {
  id: string;
  name: string;
  reasoning: boolean;
  modalities?: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">;
    output: Array<"text" | "audio" | "image" | "video" | "pdf">;
  };
  limit: {
    context: number;
    output: number;
  };
  status?: "alpha" | "beta" | "deprecated";
}

export interface OpenCodeProviderSummary {
  id: string;
  name: string;
  models: Record<string, OpenCodeProviderModel>;
}

export class OpenCodeMonitorService {
  private readonly connection: OpenCodeConnection;

  public constructor(connection: OpenCodeConnection) {
    this.connection = connection;
  }

  public async listSessions(): Promise<{
    data: MappedThreadListItem[];
  }>;
  public async listSessions(input: {
    directory?: string;
  }): Promise<{
    data: MappedThreadListItem[];
  }>;
  public async listSessions(input?: {
    directory?: string;
  }): Promise<{
    data: MappedThreadListItem[];
  }> {
    const client = this.connection.getClient();
    const directory = input?.directory?.trim();
    const result = await client.session.list(
      directory
        ? {
            query: {
              directory
            }
          }
        : {}
    );
    const sessions = (result.data ?? []) as Session[];

    return {
      data: sessions.map(sessionToThreadListItem)
    };
  }

  public async listProjectDirectories(): Promise<string[]> {
    const client = this.connection.getClient();
    const result = await client.project.list();
    const projects = (result.data ?? []) as Project[];
    return projects
      .map((project) => project.worktree)
      .filter((directory) => directory.trim().length > 0);
  }

  public async listProviders(input?: {
    directory?: string;
  }): Promise<{
    all: OpenCodeProviderSummary[];
    defaults: Record<string, string>;
    connected: string[];
  }> {
    const client = this.connection.getClient();
    const directory = input?.directory?.trim();
    const result = await client.provider.list(
      directory
        ? {
            query: {
              directory
            }
          }
        : {}
    );

    const payload = result.data as {
      all?: OpenCodeProviderSummary[];
      default?: Record<string, string>;
      connected?: string[];
    };

    return {
      all: payload.all ?? [],
      defaults: payload.default ?? {},
      connected: payload.connected ?? []
    };
  }

  public async listAgents(input?: {
    directory?: string;
  }): Promise<Agent[]> {
    const client = this.connection.getClient();
    const directory = input?.directory?.trim();
    const result = await client.app.agents(
      directory
        ? {
            query: {
              directory
            }
          }
        : {}
    );
    return (result.data ?? []) as Agent[];
  }

  public async createSession(input?: OpenCodeCreateSessionInput): Promise<{
    threadId: string;
    session: Session;
    mapped: MappedThreadListItem;
  }> {
    const client = this.connection.getClient();
    const directory = input?.directory?.trim();
    const body: Record<string, string> = {};
    if (input?.title) {
      body["title"] = input.title;
    }
    const result = await client.session.create({
      body,
      ...(directory
        ? {
            query: {
              directory
            }
          }
        : {})
    });

    const session = result.data as Session;
    return {
      threadId: session.id,
      session,
      mapped: sessionToThreadListItem(session)
    };
  }

  public async getSession(sessionId: string, directory?: string): Promise<Session> {
    const client = this.connection.getClient();
    const normalizedDirectory = directory?.trim();
    const result = await client.session.get({
      path: { id: sessionId },
      ...(normalizedDirectory
        ? {
            query: {
              directory: normalizedDirectory
            }
          }
        : {})
    });
    return result.data as Session;
  }

  public async getSessionState(
    sessionId: string,
    directory?: string
  ): Promise<MappedThreadConversationState> {
    const client = this.connection.getClient();
    const normalizedDirectory = directory?.trim();

    const [sessionResult, messagesResult] = await Promise.all([
      client.session.get({
        path: { id: sessionId },
        ...(normalizedDirectory
          ? {
              query: {
                directory: normalizedDirectory
              }
            }
          : {})
      }),
      client.session.messages({
        path: { id: sessionId },
        ...(normalizedDirectory
          ? {
              query: {
                directory: normalizedDirectory
              }
            }
          : {})
      })
    ]);

    const session = sessionResult.data as Session;
    const messages = (messagesResult.data ?? []) as Array<{
      info: Message;
      parts: Part[];
    }>;

    const messageList: Message[] = [];
    const partsByMessage = new Map<string, Part[]>();

    for (const entry of messages) {
      messageList.push(entry.info);
      partsByMessage.set(entry.info.id, entry.parts);
    }

    return sessionToConversationState(session, messageList, partsByMessage);
  }

  public async sendMessage(input: OpenCodeSendMessageInput): Promise<void> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("Message text is required");
    }

    const client = this.connection.getClient();
    const directory = input.directory?.trim();
    await client.session.prompt({
      path: { id: input.sessionId },
      ...(directory
        ? {
            query: {
              directory
            }
          }
        : {}),
      body: {
        ...(input.model
          ? {
              model: {
                providerID: input.model.providerID,
                modelID: input.model.modelID
              }
            }
          : {}),
        ...(input.agent
          ? {
              agent: input.agent
            }
          : {}),
        parts: [
          { type: "text", text }
        ]
      }
    });
  }

  public async abort(sessionId: string, directory?: string): Promise<void> {
    const client = this.connection.getClient();
    const normalizedDirectory = directory?.trim();
    await client.session.abort({
      path: { id: sessionId },
      ...(normalizedDirectory
        ? {
            query: {
              directory: normalizedDirectory
            }
          }
        : {})
    });
  }

  public async deleteSession(sessionId: string, directory?: string): Promise<void> {
    const client = this.connection.getClient();
    const normalizedDirectory = directory?.trim();
    await client.session.delete({
      path: { id: sessionId },
      ...(normalizedDirectory
        ? {
            query: {
              directory: normalizedDirectory
            }
          }
        : {})
    });
  }
}
