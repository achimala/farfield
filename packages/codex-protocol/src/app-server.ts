import { z } from "zod";
import { ProtocolValidationError } from "./errors.js";
import { CollaborationModeSchema, ThreadConversationStateSchema } from "./thread.js";
import {
  APP_SERVER_CLIENT_NOTIFICATION_METHODS,
  APP_SERVER_CLIENT_REQUEST_METHODS,
  APP_SERVER_SERVER_NOTIFICATION_METHODS,
  APP_SERVER_SERVER_REQUEST_METHODS,
  type AppServerClientNotificationMethod,
  type AppServerClientRequestMethod,
  type AppServerServerNotificationMethod,
  type AppServerServerRequestMethod,
  CollaborationModeListResponseSchema as GeneratedCollaborationModeListResponseSchema,
  ExperimentalServerRequestSchema as GeneratedExperimentalServerRequestSchema,
  GetAccountRateLimitsResponseSchema as GeneratedGetAccountRateLimitsResponseSchema,
  ModelListResponseSchema as GeneratedModelListResponseSchema,
  StableServerRequestSchema as GeneratedStableServerRequestSchema,
  ThreadListResponseSchema as GeneratedThreadListResponseSchema,
  ThreadReadResponseSchema as GeneratedThreadReadResponseSchema,
  ThreadStartParamsSchema as GeneratedThreadStartParamsSchema
} from "./generated/app-server/index.js";

const AppServerThreadListResponseBaseSchema = GeneratedThreadListResponseSchema.passthrough();
const AppServerThreadReadResponseBaseSchema = GeneratedThreadReadResponseSchema.passthrough();
const AppServerModelListResponseBaseSchema = GeneratedModelListResponseSchema.passthrough();
const AppServerGetAccountRateLimitsResponseBaseSchema =
  GeneratedGetAccountRateLimitsResponseSchema.passthrough();
const AppServerStartThreadRequestBaseSchema = GeneratedThreadStartParamsSchema.passthrough();
const AppServerServerRequestBaseSchema = z.union([
  GeneratedStableServerRequestSchema,
  GeneratedExperimentalServerRequestSchema
]);

const ThreadTitleSchema = z.union([z.string(), z.null()]).optional();
const ThreadIsGeneratingSchema = z.boolean().optional();
const AppServerModelReasoningEffortItemSchema = z
  .object({
    reasoningEffort: z.string(),
    description: z.string().optional()
  })
  .passthrough();

const AppServerGeneratedThreadListItemSchema = z
  .object({
    id: z.string().min(1),
    preview: z.string(),
    title: ThreadTitleSchema,
    name: z.union([z.string(), z.null()]).optional(),
    isGenerating: ThreadIsGeneratingSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    cwd: z.string().optional(),
    source: z.any().optional(),
    modelProvider: z.string().optional(),
    cliVersion: z.string().optional(),
    path: z.union([z.string(), z.null()]).optional(),
    gitInfo: z.any().optional(),
    status: z.any().optional(),
    turns: z.array(z.any()).optional()
  })
  .passthrough();

const OpenCodeThreadListItemSchema = z
  .object({
    id: z.string().min(1),
    preview: z.string(),
    title: ThreadTitleSchema,
    isGenerating: ThreadIsGeneratingSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    cwd: z.string().optional(),
    source: z.literal("opencode")
  })
  .passthrough();

export const AppServerThreadListItemSchema = z.union([
  AppServerGeneratedThreadListItemSchema,
  OpenCodeThreadListItemSchema
]);

export const AppServerListThreadsResponseSchema = z
  .object({
    data: z.array(AppServerThreadListItemSchema),
    nextCursor: z.union([z.string(), z.null()]).optional(),
    pages: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional()
  })
  .passthrough();

export const AppServerReadThreadResponseSchema: z.ZodObject<
  {
    thread: typeof ThreadConversationStateSchema;
  },
  "passthrough"
> = z
  .object({
    thread: ThreadConversationStateSchema
  })
  .passthrough();

export const AppServerModelSchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().optional(),
    hidden: z.boolean().optional(),
    supportedReasoningEfforts: z.array(AppServerModelReasoningEffortItemSchema).default([]),
    defaultReasoningEffort: z.string().optional(),
    inputModalities: z.array(z.any()).optional(),
    supportsPersonality: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    upgrade: z.union([z.string(), z.null()]).optional(),
    upgradeInfo: z.any().optional(),
    availabilityNux: z.any().optional()
  })
  .passthrough();

export const AppServerModelReasoningEffortSchema =
  AppServerModelReasoningEffortItemSchema;

export const AppServerListModelsResponseSchema = z
  .object({
    data: z.array(AppServerModelSchema),
    nextCursor: z.union([z.string(), z.null()]).optional()
  })
  .passthrough();

export const AppServerCollaborationModeListItemSchema = z
  .object({
    name: z.string().optional(),
    mode: z.string().optional(),
    model: z.union([z.string(), z.null()]).optional(),
    reasoning_effort: z.union([z.string(), z.null()]).optional(),
    developer_instructions: z.union([z.string(), z.null()]).optional(),
    settings: z
      .object({
        model: z.union([z.string(), z.null()]).optional(),
        reasoning_effort: z.union([z.string(), z.null()]).optional(),
        developer_instructions: z.union([z.string(), z.null()]).optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export const AppServerCollaborationModeListResponseSchema = z
  .object({
    data: z.array(AppServerCollaborationModeListItemSchema),
    nextCursor: z.union([z.string(), z.null()]).optional()
  })
  .passthrough();

export const AppServerStartThreadRequestSchema = AppServerStartThreadRequestBaseSchema;

export const AppServerStartThreadResponseSchema = z
  .object({
    thread: AppServerThreadListItemSchema,
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    cwd: z.string().optional(),
    approvalPolicy: z.string().optional(),
    sandbox: z.any().optional(),
    reasoningEffort: z.union([z.string(), z.null()]).optional()
  })
  .passthrough();

export const AppServerServerRequestSchema = AppServerServerRequestBaseSchema;

export const AppServerGetAccountRateLimitsResponseSchema =
  AppServerGetAccountRateLimitsResponseBaseSchema;

export const AppServerLoadedThreadListResponseSchema = z
  .object({
    data: z.array(z.string().min(1)),
    nextCursor: z.union([z.string(), z.null()]).optional()
  })
  .passthrough();

export const AppServerSetModeRequestSchema = z
  .object({
    conversationId: z.string().min(1),
    collaborationMode: CollaborationModeSchema
  })
  .passthrough();

export type AppServerListThreadsResponse = z.infer<typeof AppServerListThreadsResponseSchema>;
export type AppServerReadThreadResponse = z.infer<typeof AppServerReadThreadResponseSchema>;
export type AppServerListModelsResponse = z.infer<typeof AppServerListModelsResponseSchema>;
export type AppServerCollaborationModeListResponse = z.infer<
  typeof AppServerCollaborationModeListResponseSchema
>;
export type AppServerStartThreadResponse = z.infer<typeof AppServerStartThreadResponseSchema>;
export type AppServerLoadedThreadListResponse = z.infer<typeof AppServerLoadedThreadListResponseSchema>;
export type AppServerGetAccountRateLimitsResponse = z.infer<
  typeof AppServerGetAccountRateLimitsResponseSchema
>;
export {
  APP_SERVER_CLIENT_REQUEST_METHODS,
  APP_SERVER_CLIENT_NOTIFICATION_METHODS,
  APP_SERVER_SERVER_REQUEST_METHODS,
  APP_SERVER_SERVER_NOTIFICATION_METHODS
};
export type {
  AppServerClientRequestMethod,
  AppServerClientNotificationMethod,
  AppServerServerRequestMethod,
  AppServerServerNotificationMethod
};

function parseWithSchema<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: z.input<Schema>,
  context: string
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod(context, result.error);
  }
  return result.data;
}

export function parseAppServerListThreadsResponse(
  value: z.input<typeof AppServerListThreadsResponseSchema>
): AppServerListThreadsResponse {
  return parseWithSchema(AppServerListThreadsResponseSchema, value, "AppServerListThreadsResponse");
}

export function parseAppServerReadThreadResponse(
  value: z.input<typeof AppServerThreadReadResponseBaseSchema>
): AppServerReadThreadResponse {
  const parsed = parseWithSchema(
    AppServerThreadReadResponseBaseSchema,
    value,
    "GeneratedAppServerReadThreadResponse"
  );
  return {
    thread: parseWithSchema(
      ThreadConversationStateSchema,
      parsed.thread,
      "AppServerReadThreadResponse.thread"
    )
  };
}

export function parseAppServerListModelsResponse(
  value: z.input<typeof AppServerListModelsResponseSchema>
): AppServerListModelsResponse {
  return parseWithSchema(AppServerListModelsResponseSchema, value, "AppServerListModelsResponse");
}

export function parseAppServerCollaborationModeListResponse(
  value: z.input<typeof AppServerCollaborationModeListResponseSchema>
): AppServerCollaborationModeListResponse {
  return parseWithSchema(
    AppServerCollaborationModeListResponseSchema,
    value,
    "AppServerCollaborationModeListResponse"
  );
}

export function parseAppServerStartThreadResponse(
  value: z.input<typeof AppServerStartThreadResponseSchema>
): AppServerStartThreadResponse {
  return parseWithSchema(AppServerStartThreadResponseSchema, value, "AppServerStartThreadResponse");
}

export function parseAppServerGetAccountRateLimitsResponse(
  value: z.input<typeof AppServerGetAccountRateLimitsResponseSchema>
): AppServerGetAccountRateLimitsResponse {
  return parseWithSchema(
    AppServerGetAccountRateLimitsResponseSchema,
    value,
    "AppServerGetAccountRateLimitsResponse"
  );
}
