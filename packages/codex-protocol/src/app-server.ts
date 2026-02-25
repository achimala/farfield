import { z } from "zod";
import { ProtocolValidationError } from "./errors.js";
import { CollaborationModeSchema, ThreadConversationStateSchema } from "./thread.js";
import {
  CollaborationModeListResponseSchema as GeneratedCollaborationModeListResponseSchema,
  GetAccountRateLimitsResponseSchema as GeneratedGetAccountRateLimitsResponseSchema,
  ModelListResponseSchema as GeneratedModelListResponseSchema,
  SendUserMessageParamsSchema as GeneratedSendUserMessageParamsSchema,
  SendUserMessageResponseSchema as GeneratedSendUserMessageResponseSchema,
  ThreadListResponseSchema as GeneratedThreadListResponseSchema,
  ThreadReadResponseSchema as GeneratedThreadReadResponseSchema,
  ThreadStartParamsSchema as GeneratedThreadStartParamsSchema
} from "./generated/app-server/index.js";

const AppServerThreadListResponseBaseSchema = GeneratedThreadListResponseSchema.passthrough();
const AppServerThreadReadResponseBaseSchema = GeneratedThreadReadResponseSchema.passthrough();
const AppServerModelListResponseBaseSchema = GeneratedModelListResponseSchema.passthrough();
const AppServerCollaborationModeListResponseBaseSchema =
  GeneratedCollaborationModeListResponseSchema.passthrough();
const AppServerStartThreadRequestBaseSchema = GeneratedThreadStartParamsSchema.passthrough();
const AppServerSendUserMessageRequestBaseSchema = GeneratedSendUserMessageParamsSchema.passthrough();
const AppServerSendUserMessageResponseBaseSchema = GeneratedSendUserMessageResponseSchema;

const AppServerGeneratedThreadListItemSchema = AppServerThreadListResponseBaseSchema.shape.data.element;

const OpenCodeThreadListItemSchema = z
  .object({
    id: z.string().min(1),
    preview: z.string(),
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

export const AppServerModelSchema = AppServerModelListResponseBaseSchema.shape.data.element;

export const AppServerModelReasoningEffortSchema =
  AppServerModelSchema.shape.supportedReasoningEfforts.element;

export const AppServerListModelsResponseSchema = AppServerModelListResponseBaseSchema;

export const AppServerCollaborationModeListItemSchema = z
  .object({
    name: z.string(),
    mode: z.union([z.string(), z.null()]).optional(),
    model: z.union([z.string(), z.null()]).optional(),
    reasoning_effort: z.union([z.string(), z.null()]).optional(),
    developer_instructions: z.union([z.string(), z.null()]).optional()
  })
  .passthrough();

export const AppServerCollaborationModeListResponseSchema = z
  .object({
    data: z.array(AppServerCollaborationModeListItemSchema)
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

export const AppServerSendUserMessageRequestSchema = AppServerSendUserMessageRequestBaseSchema;

export const AppServerSendUserMessageResponseSchema = AppServerSendUserMessageResponseBaseSchema;

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

const AppServerGetAccountRateLimitsResponseBaseSchema =
  GeneratedGetAccountRateLimitsResponseSchema.passthrough();

export const AppServerGetAccountRateLimitsResponseSchema =
  AppServerGetAccountRateLimitsResponseBaseSchema;

export type AppServerGetAccountRateLimitsResponse = z.infer<
  typeof AppServerGetAccountRateLimitsResponseSchema
>;

export function parseAppServerGetAccountRateLimitsResponse(
  value: z.input<typeof AppServerGetAccountRateLimitsResponseSchema>
): AppServerGetAccountRateLimitsResponse {
  return parseWithSchema(
    AppServerGetAccountRateLimitsResponseSchema,
    value,
    "AppServerGetAccountRateLimitsResponse"
  );
}
