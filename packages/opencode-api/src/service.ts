import type {
  Session,
  Message,
  Part
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
}

export interface OpenCodeCreateSessionInput {
  title?: string;
}

export class OpenCodeMonitorService {
  private readonly connection: OpenCodeConnection;

  public constructor(connection: OpenCodeConnection) {
    this.connection = connection;
  }

  public async listSessions(): Promise<{
    data: MappedThreadListItem[];
  }> {
    const client = this.connection.getClient();
    const result = await client.session.list();
    const sessions = (result.data ?? []) as Session[];

    return {
      data: sessions.map(sessionToThreadListItem)
    };
  }

  public async createSession(input?: OpenCodeCreateSessionInput): Promise<{
    threadId: string;
    session: Session;
    mapped: MappedThreadListItem;
  }> {
    const client = this.connection.getClient();
    const body: Record<string, string> = {};
    if (input?.title) {
      body["title"] = input.title;
    }
    const result = await client.session.create({ body });

    const session = result.data as Session;
    return {
      threadId: session.id,
      session,
      mapped: sessionToThreadListItem(session)
    };
  }

  public async getSession(sessionId: string): Promise<Session> {
    const client = this.connection.getClient();
    const result = await client.session.get({
      path: { id: sessionId }
    });
    return result.data as Session;
  }

  public async getSessionState(
    sessionId: string
  ): Promise<MappedThreadConversationState> {
    const client = this.connection.getClient();

    const [sessionResult, messagesResult] = await Promise.all([
      client.session.get({ path: { id: sessionId } }),
      client.session.messages({ path: { id: sessionId } })
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
    await client.session.prompt({
      path: { id: input.sessionId },
      body: {
        parts: [
          { type: "text", text }
        ]
      }
    });
  }

  public async abort(sessionId: string): Promise<void> {
    const client = this.connection.getClient();
    await client.session.abort({
      path: { id: sessionId }
    });
  }

  public async deleteSession(sessionId: string): Promise<void> {
    const client = this.connection.getClient();
    await client.session.delete({
      path: { id: sessionId }
    });
  }
}
