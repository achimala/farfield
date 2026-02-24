import {
  type AppServerCollaborationModeListResponse,
  AppServerCollaborationModeListResponseSchema,
  type AppServerListModelsResponse,
  AppServerListModelsResponseSchema,
  type AppServerListThreadsResponse,
  AppServerListThreadsResponseSchema,
  type AppServerReadThreadResponse,
  AppServerReadThreadResponseSchema,
  AppServerSendUserMessageRequestSchema,
  AppServerSendUserMessageResponseSchema,
  type AppServerStartThreadResponse,
  AppServerStartThreadRequestSchema,
  AppServerStartThreadResponseSchema,
  type AppServerGetAccountRateLimitsResponse,
  AppServerGetAccountRateLimitsResponseSchema
} from "@farfield/protocol";
import { ProtocolValidationError } from "@farfield/protocol";
import { z } from "zod";
import {
  AppServerTransport,
  ChildProcessAppServerTransport,
  type ChildProcessAppServerTransportOptions
} from "./app-server-transport.js";

function parseWithSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  context: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw ProtocolValidationError.fromZod(context, parsed.error);
  }
  return parsed.data;
}

export interface ListThreadsOptions {
  limit: number;
  archived: boolean;
  cursor?: string;
}

export interface ListThreadsAllOptions {
  limit: number;
  archived: boolean;
  cursor?: string;
  maxPages: number;
}

export interface StartThreadOptions {
  cwd: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  sandbox?: string;
  approvalPolicy?: string;
  ephemeral?: boolean;
}

const AppServerResumeThreadRequestSchema = z
  .object({
    threadId: z.string().min(1),
    persistExtendedHistory: z.boolean()
  })
  .passthrough();

export class AppServerClient {
  private readonly transport: AppServerTransport;

  public constructor(transportOrOptions: AppServerTransport | ChildProcessAppServerTransportOptions) {
    if ("request" in transportOrOptions && "close" in transportOrOptions) {
      this.transport = transportOrOptions;
      return;
    }

    this.transport = new ChildProcessAppServerTransport(transportOrOptions);
  }

  public async close(): Promise<void> {
    await this.transport.close();
  }

  public async listThreads(options: ListThreadsOptions): Promise<AppServerListThreadsResponse> {
    const result = await this.transport.request("thread/list", {
      limit: options.limit,
      archived: options.archived,
      cursor: options.cursor ?? null
    });

    return parseWithSchema(AppServerListThreadsResponseSchema, result, "AppServerListThreadsResponse");
  }

  public async listThreadsAll(options: ListThreadsAllOptions): Promise<AppServerListThreadsResponse> {
    const listItems: AppServerListThreadsResponse["data"] = [];

    let cursor = options.cursor;
    let pages = 0;

    while (pages < options.maxPages) {
      const page = await this.listThreads(
        cursor
          ? {
              limit: options.limit,
              archived: options.archived,
              cursor
            }
          : {
              limit: options.limit,
              archived: options.archived
            }
      );

      listItems.push(...page.data);
      pages += 1;

      const nextCursor = page.nextCursor ?? null;
      if (!nextCursor || page.data.length === 0) {
        return {
          data: listItems,
          nextCursor: null,
          pages,
          truncated: false
        };
      }

      cursor = nextCursor;
    }

    return {
      data: listItems,
      nextCursor: cursor ?? null,
      pages,
      truncated: true
    };
  }

  public async readThread(threadId: string, includeTurns = true): Promise<AppServerReadThreadResponse> {
    const result = await this.transport.request("thread/read", {
      threadId,
      includeTurns
    });

    return parseWithSchema(AppServerReadThreadResponseSchema, result, "AppServerReadThreadResponse");
  }

  public async listModels(limit = 100): Promise<AppServerListModelsResponse> {
    const result = await this.transport.request("model/list", { limit });
    return parseWithSchema(AppServerListModelsResponseSchema, result, "AppServerListModelsResponse");
  }

  public async listCollaborationModes(): Promise<AppServerCollaborationModeListResponse> {
    const result = await this.transport.request("collaborationMode/list", {});
    return parseWithSchema(
      AppServerCollaborationModeListResponseSchema,
      result,
      "AppServerCollaborationModeListResponse"
    );
  }

  public async startThread(options: StartThreadOptions): Promise<AppServerStartThreadResponse> {
    const request = AppServerStartThreadRequestSchema.parse(options);
    const result = await this.transport.request("thread/start", request);
    return parseWithSchema(AppServerStartThreadResponseSchema, result, "AppServerStartThreadResponse");
  }

  public async sendUserMessage(threadId: string, text: string): Promise<void> {
    const request = AppServerSendUserMessageRequestSchema.parse({
      conversationId: threadId,
      items: [
        {
          type: "text",
          data: {
            text
          }
        }
      ]
    });
    const result = await this.transport.request("sendUserMessage", request);
    parseWithSchema(AppServerSendUserMessageResponseSchema, result, "AppServerSendUserMessageResponse");
  }

  public async resumeThread(
    threadId: string,
    options?: { persistExtendedHistory?: boolean }
  ): Promise<AppServerReadThreadResponse> {
    const request = AppServerResumeThreadRequestSchema.parse({
      threadId,
      persistExtendedHistory: options?.persistExtendedHistory ?? true
    });
    const result = await this.transport.request("thread/resume", request);
    return parseWithSchema(AppServerReadThreadResponseSchema, result, "AppServerResumeThreadResponse");
  }

  public async readAccountRateLimits(): Promise<AppServerGetAccountRateLimitsResponse> {
    const result = await this.transport.request("account/rateLimits/read", {});
    return parseWithSchema(
      AppServerGetAccountRateLimitsResponseSchema,
      result,
      "AppServerGetAccountRateLimitsResponse"
    );
  }
}
