import { z } from "zod";
import { NonEmptyStringSchema, NonNegativeIntSchema, NullableNonEmptyStringSchema } from "./common.js";
import { ProtocolValidationError } from "./errors.js";
import { CollaborationModeSchema, ThreadConversationStateSchema } from "./thread.js";

export const AppServerThreadListItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    preview: z.string(),
    modelProvider: z.string().optional(),
    createdAt: NonNegativeIntSchema,
    updatedAt: NonNegativeIntSchema,
    path: z.string().optional(),
    cwd: z.string().optional(),
    cliVersion: z.string().optional(),
    source: z.string().optional(),
    gitInfo: z.unknown().nullable().optional(),
    turns: z.array(z.unknown()).optional()
  })
  .passthrough();

export const AppServerListThreadsResponseSchema = z
  .object({
    data: z.array(AppServerThreadListItemSchema),
    nextCursor: z.string().nullable().optional(),
    pages: NonNegativeIntSchema.optional(),
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

export const AppServerModelReasoningEffortSchema = z
  .object({
    reasoningEffort: NonEmptyStringSchema,
    description: z.string()
  })
  .passthrough();

export const AppServerModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    model: NonEmptyStringSchema,
    upgrade: z.union([NonEmptyStringSchema, z.null()]),
    displayName: z.string(),
    description: z.string(),
    supportedReasoningEfforts: z.array(AppServerModelReasoningEffortSchema),
    defaultReasoningEffort: NonEmptyStringSchema,
    inputModalities: z.array(NonEmptyStringSchema),
    supportsPersonality: z.boolean(),
    isDefault: z.boolean()
  })
  .passthrough();

export const AppServerListModelsResponseSchema = z
  .object({
    data: z.array(AppServerModelSchema),
    nextCursor: z.union([z.string(), z.null()])
  })
  .passthrough();

export const AppServerCollaborationModeListItemSchema = z
  .object({
    name: z.string(),
    mode: NonEmptyStringSchema,
    model: NullableNonEmptyStringSchema,
    reasoning_effort: NullableNonEmptyStringSchema,
    developer_instructions: z.union([z.string(), z.null()])
  })
  .passthrough();

export const AppServerCollaborationModeListResponseSchema = z
  .object({
    data: z.array(AppServerCollaborationModeListItemSchema)
  })
  .passthrough();

export const AppServerStartThreadRequestSchema = z
  .object({
    cwd: z.string(),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    personality: z.string().optional(),
    sandbox: z.string().optional(),
    approvalPolicy: z.string().optional(),
    ephemeral: z.boolean().optional()
  })
  .passthrough();

export const AppServerStartThreadResponseSchema = z
  .object({
    thread: AppServerThreadListItemSchema,
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    cwd: z.string().optional(),
    approvalPolicy: z.string().optional(),
    sandbox: z.unknown().optional(),
    reasoningEffort: z.string().optional()
  })
  .passthrough();

export const AppServerSendUserMessageItemSchema = z
  .object({
    type: z.literal("text"),
    data: z
      .object({
        text: z.string()
      })
      .passthrough()
  })
  .passthrough();

export const AppServerSendUserMessageRequestSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
    items: z.array(AppServerSendUserMessageItemSchema).min(1)
  })
  .passthrough();

export const AppServerSendUserMessageResponseSchema = z.object({}).passthrough();

export const AppServerSetModeRequestSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
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

export function parseAppServerListThreadsResponse(
  value: unknown
): AppServerListThreadsResponse {
  const result = AppServerListThreadsResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerListThreadsResponse", result.error);
  }
  return result.data;
}

export function parseAppServerReadThreadResponse(value: unknown): AppServerReadThreadResponse {
  const result = AppServerReadThreadResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerReadThreadResponse", result.error);
  }
  return result.data;
}

export function parseAppServerListModelsResponse(value: unknown): AppServerListModelsResponse {
  const result = AppServerListModelsResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerListModelsResponse", result.error);
  }
  return result.data;
}

export function parseAppServerCollaborationModeListResponse(
  value: unknown
): AppServerCollaborationModeListResponse {
  const result = AppServerCollaborationModeListResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod(
      "AppServerCollaborationModeListResponse",
      result.error
    );
  }
  return result.data;
}

export function parseAppServerStartThreadResponse(value: unknown): AppServerStartThreadResponse {
  const result = AppServerStartThreadResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerStartThreadResponse", result.error);
  }
  return result.data;
}
