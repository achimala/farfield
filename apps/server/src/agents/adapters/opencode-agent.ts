import fs from "node:fs";
import path from "node:path";
import {
  OpenCodeConnection,
  OpenCodeMonitorService,
} from "@farfield/opencode-api";
import {
  AppServerCollaborationModeListResponseSchema,
  AppServerListModelsResponseSchema,
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
    canListModels: true,
    canListCollaborationModes: true,
    canSetCollaborationMode: true,
    canSubmitUserInput: false,
    canReadLiveState: false,
    canReadStreamEvents: false,
    canReadRateLimits: false,
  };

  private readonly connection: OpenCodeConnection;
  private readonly service: OpenCodeMonitorService;
  private readonly threadDirectoryById = new Map<string, string>();
  private readonly threadModeById = new Map<
    string,
    {
      mode: string;
      model: string | null;
      reasoningEffort: string | null;
    }
  >();

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
    const selectedMode = this.threadModeById.get(input.threadId);
    const modelSelection = selectedMode?.model
      ? parseModelSelection(selectedMode.model)
      : null;

    await this.service.sendMessage({
      sessionId: input.threadId,
      text: input.text,
      ...(selectedMode
        ? {
            agent: selectedMode.mode,
          }
        : {}),
      ...(modelSelection
        ? {
            model: modelSelection,
          }
        : {}),
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

  public async listModels(limit: number) {
    this.ensureConnected();

    const providers = await this.service.listProviders();
    const models: Array<{
      id: string;
      model: string;
      displayName: string;
      description: string;
      hidden: boolean;
      isDefault: boolean;
      inputModalities: Array<"text" | "image">;
      supportedReasoningEfforts: Array<{
        reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
        description: string;
      }>;
      defaultReasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
      supportsPersonality: boolean;
      upgrade?: string | null;
    }> = [];

    for (const provider of providers.all) {
      const defaultModelId = providers.defaults[provider.id] ?? null;
      for (const model of Object.values(provider.models)) {
        const id = `${provider.id}/${model.id}`;
        const supportsReasoning = model.reasoning;
        const inputModalities = mapInputModalities(model.modalities?.input ?? []);
        models.push({
          id,
          model: id,
          displayName: `${provider.name} ${model.name}`,
          description: `${provider.name} model from OpenCode provider registry`,
          hidden: model.status === "deprecated",
          isDefault: model.id === defaultModelId,
          inputModalities,
          supportedReasoningEfforts: supportsReasoning
            ? [
                { reasoningEffort: "minimal", description: "Minimal reasoning" },
                { reasoningEffort: "low", description: "Low reasoning" },
                { reasoningEffort: "medium", description: "Medium reasoning" },
                { reasoningEffort: "high", description: "High reasoning" },
              ]
            : [{ reasoningEffort: "none", description: "Reasoning disabled" }],
          defaultReasoningEffort: supportsReasoning ? "medium" : "none",
          supportsPersonality: false,
          upgrade: null,
        });
      }
    }

    models.sort((left, right) => left.displayName.localeCompare(right.displayName));

    return AppServerListModelsResponseSchema.parse({
      data: models.slice(0, Math.max(1, limit)),
      nextCursor: null,
    });
  }

  public async listCollaborationModes() {
    this.ensureConnected();

    const agents = await this.service.listAgents();
    const data = agents.map((agent) => {
      return {
        name: agent.name,
        mode: agent.name,
        model: agent.model ? `${agent.model.providerID}/${agent.model.modelID}` : null,
        reasoning_effort: null,
        developer_instructions: agent.prompt ?? null,
      };
    });

    return AppServerCollaborationModeListResponseSchema.parse({ data });
  }

  public async setCollaborationMode(input: {
    threadId: string;
    collaborationMode: {
      mode: string;
      settings: {
        model?: string | null;
        reasoning_effort?: string | null;
      };
    };
  }): Promise<{ ownerClientId: string }> {
    this.ensureConnected();
    this.threadModeById.set(input.threadId, {
      mode: input.collaborationMode.mode,
      model: input.collaborationMode.settings.model ?? null,
      reasoningEffort: input.collaborationMode.settings.reasoning_effort ?? null,
    });
    return {
      ownerClientId: "opencode",
    };
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

function parseModelSelection(
  model: string,
): { providerID: string; modelID: string } | null {
  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  const providerID = trimmed.slice(0, separatorIndex).trim();
  const modelID = trimmed.slice(separatorIndex + 1).trim();
  if (!providerID || !modelID) {
    return null;
  }

  return {
    providerID,
    modelID,
  };
}

function mapInputModalities(
  modalities: Array<"text" | "audio" | "image" | "video" | "pdf">,
): Array<"text" | "image"> {
  const mapped = new Set<"text" | "image">();
  for (const modality of modalities) {
    if (modality === "text" || modality === "image") {
      mapped.add(modality);
    }
  }

  if (mapped.size === 0) {
    mapped.add("text");
  }

  return Array.from(mapped);
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
