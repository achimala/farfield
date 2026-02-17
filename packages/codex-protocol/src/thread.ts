import { z } from "zod";
import {
  JsonValueSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  NullableNonEmptyStringSchema,
  NullableStringSchema
} from "./common.js";
import { ProtocolValidationError } from "./errors.js";

export const CollaborationModeSettingsSchema = z
  .object({
    model: NullableStringSchema.optional(),
    reasoning_effort: NullableStringSchema.optional(),
    developer_instructions: z.union([z.string(), z.null()]).optional()
  })
  .strict();

export const CollaborationModeSchema = z
  .object({
    mode: NonEmptyStringSchema,
    settings: CollaborationModeSettingsSchema
  })
  .strict();

export const InputTextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    text_elements: z.array(JsonValueSchema).optional()
  })
  .strict();

export const InputImagePartSchema = z
  .object({
    type: z.literal("image"),
    url: z.string()
  })
  .passthrough();

export const InputPartSchema = z.union([InputTextPartSchema, InputImagePartSchema]);

export const TurnStartParamsSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    input: z.array(InputPartSchema),
    cwd: NonEmptyStringSchema.optional(),
    model: NullableStringSchema.optional(),
    effort: NullableStringSchema.optional(),
    approvalPolicy: NonEmptyStringSchema.optional(),
    sandboxPolicy: z.object({ type: NonEmptyStringSchema }).passthrough().optional(),
    summary: z.string().optional(),
    attachments: z.array(JsonValueSchema).optional(),
    collaborationMode: z.union([CollaborationModeSchema, z.null()]).optional(),
    personality: z.union([JsonValueSchema, z.null()]).optional(),
    outputSchema: z.union([JsonValueSchema, z.null()]).optional()
  })
  .strict();

export const UserMessageContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    text_elements: z.array(JsonValueSchema).optional()
  })
  .strict();

export const UserMessageImageContentPartSchema = z
  .object({
    type: z.literal("image"),
    url: z.string()
  })
  .passthrough();

export const UserMessagePartSchema = z.union([
  UserMessageContentPartSchema,
  UserMessageImageContentPartSchema
]);

export const UserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("userMessage"),
    content: z.array(UserMessagePartSchema)
  })
  .strict();

export const SteeringUserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("steeringUserMessage"),
    content: z.array(UserMessagePartSchema),
    attachments: z.array(JsonValueSchema).optional()
  })
  .strict();

export const AgentMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("agentMessage"),
    text: z.string()
  })
  .strict();

export const ReasoningItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("reasoning"),
    summary: z.array(z.string()).optional(),
    content: z.array(JsonValueSchema).optional(),
    text: z.string().optional()
  })
  .strict();

export const PlanItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("plan"),
    text: z.string()
  })
  .strict();

export const UserInputAnsweredQuestionSchema = z
  .object({
    id: NonEmptyStringSchema,
    header: z.string().optional(),
    question: z.string().optional()
  })
  .strict();

export const UserInputResponseItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("userInputResponse"),
    requestId: NonNegativeIntSchema,
    turnId: NonEmptyStringSchema,
    questions: z.array(UserInputAnsweredQuestionSchema),
    answers: z.record(z.array(z.string())),
    completed: z.boolean()
  })
  .strict();

export const CommandActionSchema = z
  .object({
    type: NonEmptyStringSchema,
    command: z.string().optional(),
    name: z.string().optional(),
    path: z.union([z.string(), z.null()]).optional(),
    query: z.string().optional()
  })
  .strict();

export const CommandExecutionItemSchema = z
  .object({
    type: z.literal("commandExecution"),
    id: NonEmptyStringSchema,
    command: z.string(),
    cwd: z.string().optional(),
    processId: z.string().optional(),
    status: NonEmptyStringSchema,
    commandActions: z.array(CommandActionSchema).optional(),
    aggregatedOutput: z.union([z.string(), z.null()]).optional(),
    exitCode: z.union([z.number().int(), z.null()]).optional(),
    durationMs: z.union([NonNegativeIntSchema, z.null()]).optional()
  })
  .strict();

export const FileChangeKindSchema = z
  .object({
    type: NonEmptyStringSchema,
    move_path: z.union([z.string(), z.null()]).optional()
  })
  .strict();

export const FileChangeEntrySchema = z
  .object({
    path: z.string(),
    kind: FileChangeKindSchema,
    diff: z.string().optional()
  })
  .strict();

export const FileChangeItemSchema = z
  .object({
    type: z.literal("fileChange"),
    id: NonEmptyStringSchema,
    changes: z.array(FileChangeEntrySchema),
    status: NonEmptyStringSchema
  })
  .strict();

export const ContextCompactionItemSchema = z
  .object({
    type: z.literal("contextCompaction"),
    id: NonEmptyStringSchema,
    completed: z.boolean()
  })
  .strict();

export const WebSearchActionSchema = z
  .object({
    type: NonEmptyStringSchema,
    query: z.string().optional(),
    queries: z.array(z.string()).optional()
  })
  .strict();

export const WebSearchItemSchema = z
  .object({
    type: z.literal("webSearch"),
    id: NonEmptyStringSchema,
    query: z.string(),
    action: WebSearchActionSchema
  })
  .strict();

export const TurnItemSchema = z.discriminatedUnion("type", [
  UserMessageItemSchema,
  SteeringUserMessageItemSchema,
  AgentMessageItemSchema,
  ReasoningItemSchema,
  PlanItemSchema,
  UserInputResponseItemSchema,
  CommandExecutionItemSchema,
  FileChangeItemSchema,
  ContextCompactionItemSchema,
  WebSearchItemSchema
]);

export const UserInputOptionSchema = z
  .object({
    label: z.string(),
    description: z.string()
  })
  .strict();

export const UserInputQuestionSchema = z
  .object({
    id: NonEmptyStringSchema,
    header: z.string(),
    question: z.string(),
    isOther: z.boolean(),
    isSecret: z.boolean(),
    options: z.array(UserInputOptionSchema)
  })
  .strict();

export const UserInputRequestParamsSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    turnId: NonEmptyStringSchema,
    itemId: NonEmptyStringSchema,
    questions: z.array(UserInputQuestionSchema)
  })
  .strict();

export const UserInputRequestSchema = z
  .object({
    method: z.literal("item/tool/requestUserInput"),
    id: NonNegativeIntSchema,
    params: UserInputRequestParamsSchema,
    completed: z.boolean().optional()
  })
  .strict();

export const ThreadTurnSchema = z
  .object({
    params: TurnStartParamsSchema.optional(),
    turnId: z.union([NonEmptyStringSchema, z.null()]).optional(),
    id: NonEmptyStringSchema.optional(),
    status: NonEmptyStringSchema,
    turnStartedAtMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    finalAssistantStartedAtMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    error: z.union([JsonValueSchema, z.null()]).optional(),
    diff: z.union([JsonValueSchema, z.null()]).optional(),
    items: z.array(TurnItemSchema)
  })
  .passthrough();

export const ThreadConversationStateSchema = z
  .object({
    id: NonEmptyStringSchema,
    turns: z.array(ThreadTurnSchema),
    requests: z.array(UserInputRequestSchema).default([]),
    createdAt: NonNegativeIntSchema.optional(),
    updatedAt: NonNegativeIntSchema.optional(),
    title: NullableStringSchema.optional(),
    latestModel: NullableStringSchema.optional(),
    latestReasoningEffort: NullableStringSchema.optional(),
    previousTurnModel: NullableStringSchema.optional(),
    latestCollaborationMode: z.union([CollaborationModeSchema, z.null()]).optional(),
    hasUnreadTurn: z.boolean().optional(),
    rolloutPath: z.string().optional(),
    cwd: z.string().optional(),
    gitInfo: z.union([JsonValueSchema, z.null()]).optional(),
    resumeState: z.string().optional(),
    latestTokenUsageInfo: JsonValueSchema.optional(),
    source: z.string().optional()
  })
  .passthrough();

export const ThreadStreamPatchPathSegmentSchema = z.union([
  NonNegativeIntSchema,
  NonEmptyStringSchema
]);

export const ThreadStreamPatchSchema = z
  .object({
    op: z.enum(["add", "replace", "remove"]),
    path: z.array(ThreadStreamPatchPathSegmentSchema).min(1),
    value: JsonValueSchema.optional()
  })
  .strict()
  .superRefine((patch, ctx) => {
    const hasValue = Object.prototype.hasOwnProperty.call(patch, "value");

    if (patch.op === "remove" && hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remove patches must not include value"
      });
    }

    if (patch.op !== "remove" && !hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${patch.op} patches must include value`
      });
    }
  });

export const ThreadStreamSnapshotChangeSchema = z
  .object({
    type: z.literal("snapshot"),
    conversationState: ThreadConversationStateSchema
  })
  .strict();

export const ThreadStreamPatchesChangeSchema = z
  .object({
    type: z.literal("patches"),
    patches: z.array(ThreadStreamPatchSchema)
  })
  .strict();

export const ThreadStreamChangeSchema = z.union([
  ThreadStreamSnapshotChangeSchema,
  ThreadStreamPatchesChangeSchema
]);

export const ThreadStreamStateChangedParamsSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
    change: ThreadStreamChangeSchema,
    version: NonNegativeIntSchema,
    type: z.literal("thread-stream-state-changed")
  })
  .strict();

export type CollaborationMode = z.infer<typeof CollaborationModeSchema>;
export type TurnStartParams = z.infer<typeof TurnStartParamsSchema>;
export type UserInputRequest = z.infer<typeof UserInputRequestSchema>;
export type ThreadConversationState = z.infer<typeof ThreadConversationStateSchema>;
export type ThreadStreamPatch = z.infer<typeof ThreadStreamPatchSchema>;
export type ThreadStreamStateChangedParams = z.infer<typeof ThreadStreamStateChangedParamsSchema>;

export function parseThreadConversationState(value: unknown): ThreadConversationState {
  const result = ThreadConversationStateSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("ThreadConversationState", result.error);
  }
  return result.data;
}

export function parseThreadStreamStateChangedParams(
  value: unknown
): ThreadStreamStateChangedParams {
  const result = ThreadStreamStateChangedParamsSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("ThreadStreamStateChangedParams", result.error);
  }
  return result.data;
}

export const UserInputAnswerSchema = z
  .object({
    answers: z.array(z.string().min(1))
  })
  .strict();

export const UserInputResponsePayloadSchema = z
  .object({
    answers: z.record(UserInputAnswerSchema)
  })
  .strict();

export type UserInputResponsePayload = z.infer<typeof UserInputResponsePayloadSchema>;

export function parseUserInputResponsePayload(value: unknown): UserInputResponsePayload {
  const result = UserInputResponsePayloadSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("UserInputResponsePayload", result.error);
  }
  return result.data;
}
