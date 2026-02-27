import fs from "node:fs";
import path from "node:path";
import {
  OpenCodeConnection,
  OpenCodeMonitorService,
} from "@farfield/opencode-api";
import {
  AppServerThreadListItemSchema,
  parseThreadConversationState,
} from "@farfield/protocol";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentCreateThreadInput,
  AgentCreateThreadResult,
  AgentInterruptInput,
  AgentListThreadsInput,
  AgentListThreadsResult,
  AgentReadThreadInput,
  AgentReadThreadResult,
  AgentSendMessageInput,
} from "../types.js";

export interface OpenCodeAgentOptions {
  url?: string;
  port?: number;
}

export class OpenCodeAgentAdapter implements AgentAdapter {
  public readonly id = "opencode";
  public readonly label = "OpenCode";
  public readonly capabilities: AgentCapabilities = {
    canListModels: false,
    canListCollaborationModes: false,
    canSetCollaborationMode: false,
    canSubmitUserInput: false,
    canReadLiveState: false,
    canReadStreamEvents: false,
  };

  private readonly connection: OpenCodeConnection;
  private readonly service: OpenCodeMonitorService;
  private readonly threadDirectoryById = new Map<string, string>();

  public constructor(options: OpenCodeAgentOptions = {}) {
    this.connection = new OpenCodeConnection({
      ...(options.url ? { url: options.url } : {}),
      ...(options.port !== undefined ? { port: options.port } : {}),
    });
    this.service = new OpenCodeMonitorService(this.connection);
  }

  public getUrl(): string | null {
    return this.connection.getUrl();
  }

  public isEnabled(): boolean {
    return true;
  }

  public isConnected(): boolean {
    return this.connection.isConnected();
  }

  public async start(): Promise<void> {
    await this.connection.start();
  }

  public async stop(): Promise<void> {
    await this.connection.stop();
  }

  public async listThreads(
    _input: AgentListThreadsInput,
  ): Promise<AgentListThreadsResult> {
    this.ensureConnected();

    const sessions = new Map<
      string,
      Awaited<
        ReturnType<OpenCodeMonitorService["listSessions"]>
      >["data"][number]
    >();
    const directories = await this.listProjectDirectories();

    if (directories.length > 0) {
      await Promise.all(
        directories.map(async (directory) => {
          const result = await this.service.listSessions({ directory });
          for (const item of result.data) {
            sessions.set(item.id, item);
            if (item.cwd && item.cwd.trim()) {
              this.threadDirectoryById.set(item.id, path.resolve(item.cwd));
            }
          }
        }),
      );
    } else {
      const result = await this.service.listSessions();
      for (const item of result.data) {
        sessions.set(item.id, item);
        if (item.cwd && item.cwd.trim()) {
          this.threadDirectoryById.set(item.id, path.resolve(item.cwd));
        }
      }
    }

    const mappedData = Array.from(sessions.values()).map((session) =>
      AppServerThreadListItemSchema.parse(session),
    );

    return {
      data: mappedData,
      nextCursor: null,
    };
  }

  public async createThread(
    input: AgentCreateThreadInput,
  ): Promise<AgentCreateThreadResult> {
    this.ensureConnected();

    const directory = input.cwd
      ? normalizeDirectoryInput(input.cwd)
      : undefined;
    const result = await this.service.createSession({
      ...(input.model ? { title: input.model } : {}),
      ...(directory ? { directory } : {}),
    });

    if (result.mapped.cwd && result.mapped.cwd.trim()) {
      this.threadDirectoryById.set(
        result.threadId,
        path.resolve(result.mapped.cwd),
      );
    } else if (directory) {
      this.threadDirectoryById.set(result.threadId, directory);
    }

    const mappedThread = AppServerThreadListItemSchema.parse(result.mapped);

    return {
      threadId: result.threadId,
      thread: mappedThread,
      cwd: mappedThread.cwd,
    };
  }

  public async readThread(
    input: AgentReadThreadInput,
  ): Promise<AgentReadThreadResult> {
    this.ensureConnected();

    const directory = this.resolveThreadDirectory(input.threadId);
    const state = await this.service.getSessionState(input.threadId, directory);

    if (state.cwd && state.cwd.trim()) {
      this.threadDirectoryById.set(input.threadId, path.resolve(state.cwd));
    }

    return {
      thread: parseThreadConversationState(state),
    };
  }

  public async sendMessage(input: AgentSendMessageInput): Promise<void> {
    this.ensureConnected();

    const directory = input.cwd
      ? normalizeDirectoryInput(input.cwd)
      : this.resolveThreadDirectory(input.threadId);

    await this.service.sendMessage({
      sessionId: input.threadId,
      text: input.text,
      ...(directory ? { directory } : {}),
    });
  }

  public async interrupt(input: AgentInterruptInput): Promise<void> {
    this.ensureConnected();
    const directory = this.resolveThreadDirectory(input.threadId);
    await this.service.abort(input.threadId, directory);
  }

  public async listProjectDirectories(): Promise<string[]> {
    this.ensureConnected();
    return normalizeDirectoryList(await this.service.listProjectDirectories());
  }

  private ensureConnected(): void {
    if (!this.connection.isConnected()) {
      throw new Error("OpenCode backend is not connected");
    }
  }

  private resolveThreadDirectory(threadId: string): string | undefined {
    const directory = this.threadDirectoryById.get(threadId);
    if (!directory) {
      return undefined;
    }
    return path.resolve(directory);
  }
}

function normalizeDirectoryInput(directory: string): string {
  const trimmed = directory.trim();
  if (trimmed.length === 0) {
    throw new Error("Directory is required");
  }

  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  const stats = fs.statSync(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }
  return resolved;
}

function normalizeDirectoryList(directories: string[]): string[] {
  const deduped = new Set<string>();
  for (const directory of directories) {
    const normalized = directory.trim();
    if (normalized.length > 0) {
      deduped.add(path.resolve(normalized));
    }
  }
  return Array.from(deduped).sort((left, right) => left.localeCompare(right));
}
