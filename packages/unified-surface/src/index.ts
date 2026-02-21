import { z } from "zod";

const NonEmptyStringSchema = z.string().min(1);
const NullableStringSchema = z.union([z.string(), z.null()]);
const NonNegativeIntSchema = z.number().int().nonnegative();

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(JsonValueSchema)])
);

export const UnifiedProviderIdSchema = z.enum(["codex", "opencode"]);
export type UnifiedProviderId = z.infer<typeof UnifiedProviderIdSchema>;

export const UNIFIED_FEATURE_IDS = [
  "listThreads",
  "createThread",
  "readThread",
  "sendMessage",
  "interrupt",
  "listModels",
  "listCollaborationModes",
  "setCollaborationMode",
  "submitUserInput",
  "readLiveState",
  "readStreamEvents",
  "listProjectDirectories"
 ] as const;

export const UnifiedFeatureIdSchema = z.enum(UNIFIED_FEATURE_IDS);
export type UnifiedFeatureId = z.infer<typeof UnifiedFeatureIdSchema>;

export const UnifiedFeatureUnavailableReasonSchema = z.enum([
  "unsupportedByProvider",
  "providerDisabled",
  "providerDisconnected",
  "providerNotReady",
  "requiresOwnerClientId"
]);
export type UnifiedFeatureUnavailableReason = z.infer<typeof UnifiedFeatureUnavailableReasonSchema>;

export const UnifiedFeatureAvailabilitySchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available")
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: UnifiedFeatureUnavailableReasonSchema,
      detail: z.string().optional()
    })
    .strict()
]);
export type UnifiedFeatureAvailability = z.infer<typeof UnifiedFeatureAvailabilitySchema>;

export type UnifiedFeatureMatrix = Record<
  UnifiedProviderId,
  Record<UnifiedFeatureId, UnifiedFeatureAvailability>
>;

export const UnifiedFeatureMatrixSchema = z
  .object({
    codex: z.record(UnifiedFeatureIdSchema, UnifiedFeatureAvailabilitySchema),
    opencode: z.record(UnifiedFeatureIdSchema, UnifiedFeatureAvailabilitySchema)
  })
  .strict();

export const UnifiedModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    displayName: z.string(),
    description: z.string(),
    defaultReasoningEffort: NullableStringSchema.optional(),
    supportedReasoningEfforts: z.array(z.string()).default([]),
    hidden: z.boolean().optional().default(false),
    isDefault: z.boolean().optional().default(false)
  })
  .strict();
export type UnifiedModel = z.infer<typeof UnifiedModelSchema>;

export const UnifiedCollaborationModeSchema = z
  .object({
    name: z.string(),
    mode: NonEmptyStringSchema,
    model: NullableStringSchema.optional(),
    reasoningEffort: NullableStringSchema.optional(),
    developerInstructions: NullableStringSchema.optional()
  })
  .strict();
export type UnifiedCollaborationMode = z.infer<typeof UnifiedCollaborationModeSchema>;

const UnifiedInputTextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string()
  })
  .strict();

const UnifiedInputImagePartSchema = z
  .object({
    type: z.literal("image"),
    url: z.string()
  })
  .strict();

export const UnifiedInputPartSchema = z.union([UnifiedInputTextPartSchema, UnifiedInputImagePartSchema]);
export type UnifiedInputPart = z.infer<typeof UnifiedInputPartSchema>;

const UnifiedQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string()
  })
  .strict();

export const UnifiedUserInputRequestIdSchema = z.union([NonNegativeIntSchema, NonEmptyStringSchema]);
export type UnifiedUserInputRequestId = z.infer<typeof UnifiedUserInputRequestIdSchema>;

export const UnifiedUserInputQuestionSchema = z
  .object({
    id: NonEmptyStringSchema,
    header: z.string(),
    question: z.string(),
    options: z.array(UnifiedQuestionOptionSchema).default([]),
    isSecret: z.boolean().optional().default(false)
  })
  .strict();
export type UnifiedUserInputQuestion = z.infer<typeof UnifiedUserInputQuestionSchema>;

export const UnifiedUserInputRequestSchema = z
  .object({
    id: UnifiedUserInputRequestIdSchema,
    method: z.literal("item/tool/requestUserInput"),
    params: z
      .object({
        threadId: NonEmptyStringSchema,
        turnId: NonEmptyStringSchema,
        itemId: NonEmptyStringSchema,
        questions: z.array(UnifiedUserInputQuestionSchema)
      })
      .strict(),
    completed: z.boolean().optional()
  })
  .strict();
export type UnifiedUserInputRequest = z.infer<typeof UnifiedUserInputRequestSchema>;

const UnifiedUserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("userMessage"),
    content: z.array(UnifiedInputPartSchema)
  })
  .strict();

const UnifiedSteeringUserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("steeringUserMessage"),
    content: z.array(UnifiedInputPartSchema),
    attachments: z.array(JsonValueSchema).optional()
  })
  .strict();

const UnifiedAgentMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("agentMessage"),
    text: z.string()
  })
  .strict();

const UnifiedErrorItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("error"),
    message: z.string(),
    willRetry: z.boolean().optional(),
    errorInfo: NullableStringSchema.optional(),
    additionalDetails: z.union([JsonValueSchema, z.null()]).optional()
  })
  .strict();

const UnifiedReasoningItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("reasoning"),
    summary: z.array(z.string()).optional(),
    text: z.string().optional()
  })
  .strict();

const UnifiedPlanItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("plan"),
    text: z.string()
  })
  .strict();

const UnifiedPlanImplementationItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("planImplementation"),
    turnId: NonEmptyStringSchema,
    planContent: z.string(),
    isCompleted: z.boolean().optional()
  })
  .strict();

const UnifiedUserInputResponseItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("userInputResponse"),
    requestId: UnifiedUserInputRequestIdSchema,
    turnId: NonEmptyStringSchema,
    questions: z.array(
      z
        .object({
          id: NonEmptyStringSchema,
          header: z.string().optional(),
          question: z.string().optional()
        })
        .strict()
    ),
    answers: z.record(z.array(z.string())),
    completed: z.boolean().optional()
  })
  .strict();

const UnifiedCommandActionSchema = z
  .object({
    type: NonEmptyStringSchema,
    command: z.string().optional(),
    name: z.string().optional(),
    path: NullableStringSchema.optional(),
    query: z.string().optional()
  })
  .strict();

const UnifiedCommandExecutionItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("commandExecution"),
    command: z.string(),
    cwd: z.string().optional(),
    processId: z.string().optional(),
    status: NonEmptyStringSchema,
    commandActions: z.array(UnifiedCommandActionSchema).optional(),
    aggregatedOutput: z.union([z.string(), z.null()]).optional(),
    exitCode: z.union([z.number().int(), z.null()]).optional(),
    durationMs: z.union([NonNegativeIntSchema, z.null()]).optional()
  })
  .strict();

const UnifiedFileChangeItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("fileChange"),
    status: NonEmptyStringSchema,
    changes: z.array(
      z
        .object({
          path: z.string(),
          kind: z
            .object({
              type: NonEmptyStringSchema,
              movePath: NullableStringSchema.optional()
            })
            .strict(),
          diff: z.string().optional()
        })
        .strict()
    )
  })
  .strict();

const UnifiedContextCompactionItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("contextCompaction"),
    completed: z.boolean().optional()
  })
  .strict();

const UnifiedWebSearchItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("webSearch"),
    query: z.string(),
    action: z
      .object({
        type: NonEmptyStringSchema,
        query: z.string().optional(),
        queries: z.array(z.string()).optional()
      })
      .strict()
  })
  .strict();

const UnifiedMcpToolCallItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("mcpToolCall"),
    server: z.string(),
    tool: z.string(),
    status: z.enum(["inProgress", "completed", "failed"]),
    arguments: JsonValueSchema,
    result: z
      .union([
        z
          .object({
            content: z.array(JsonValueSchema),
            structuredContent: z.union([JsonValueSchema, z.null()]).optional()
          })
          .strict(),
        z.null()
      ])
      .optional(),
    error: z
      .union([
        z
          .object({
            message: z.string()
          })
          .strict(),
        z.null()
      ])
      .optional(),
    durationMs: z.union([NonNegativeIntSchema, z.null()]).optional()
  })
  .strict();

const UnifiedCollabAgentToolCallItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("collabAgentToolCall"),
    tool: z.enum(["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent"]),
    status: z.enum(["inProgress", "completed", "failed"]),
    senderThreadId: z.string(),
    receiverThreadIds: z.array(z.string()),
    prompt: NullableStringSchema.optional(),
    agentsStates: z.record(
      z
        .object({
          status: z.enum(["pendingInit", "running", "completed", "errored", "shutdown", "notFound"]),
          message: NullableStringSchema.optional()
        })
        .strict()
    )
  })
  .strict();

const UnifiedImageViewItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("imageView"),
    path: z.string()
  })
  .strict();

const UnifiedEnteredReviewModeItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("enteredReviewMode"),
    review: z.string()
  })
  .strict();

const UnifiedExitedReviewModeItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("exitedReviewMode"),
    review: z.string()
  })
  .strict();

const UnifiedModelChangedItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("modelChanged"),
    fromModel: NullableStringSchema.optional(),
    toModel: NullableStringSchema.optional()
  })
  .strict();

export const UnifiedItemSchema = z.discriminatedUnion("type", [
  UnifiedUserMessageItemSchema,
  UnifiedSteeringUserMessageItemSchema,
  UnifiedAgentMessageItemSchema,
  UnifiedErrorItemSchema,
  UnifiedReasoningItemSchema,
  UnifiedPlanItemSchema,
  UnifiedPlanImplementationItemSchema,
  UnifiedUserInputResponseItemSchema,
  UnifiedCommandExecutionItemSchema,
  UnifiedFileChangeItemSchema,
  UnifiedContextCompactionItemSchema,
  UnifiedWebSearchItemSchema,
  UnifiedMcpToolCallItemSchema,
  UnifiedCollabAgentToolCallItemSchema,
  UnifiedImageViewItemSchema,
  UnifiedEnteredReviewModeItemSchema,
  UnifiedExitedReviewModeItemSchema,
  UnifiedModelChangedItemSchema
]);

export type UnifiedItem = z.infer<typeof UnifiedItemSchema>;
export type UnifiedItemKind = UnifiedItem["type"];

export const UNIFIED_ITEM_KINDS = [
  "userMessage",
  "steeringUserMessage",
  "agentMessage",
  "error",
  "reasoning",
  "plan",
  "planImplementation",
  "userInputResponse",
  "commandExecution",
  "fileChange",
  "contextCompaction",
  "webSearch",
  "mcpToolCall",
  "collabAgentToolCall",
  "imageView",
  "enteredReviewMode",
  "exitedReviewMode",
  "modelChanged"
] as const satisfies ReadonlyArray<UnifiedItemKind>;

export const UnifiedTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    turnId: z.union([NonEmptyStringSchema, z.null()]).optional(),
    status: NonEmptyStringSchema,
    turnStartedAtMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    finalAssistantStartedAtMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    error: z.union([JsonValueSchema, z.null()]).optional(),
    diff: z.union([JsonValueSchema, z.null()]).optional(),
    items: z.array(UnifiedItemSchema)
  })
  .strict();
export type UnifiedTurn = z.infer<typeof UnifiedTurnSchema>;

export const UnifiedThreadSchema = z
  .object({
    id: NonEmptyStringSchema,
    provider: UnifiedProviderIdSchema,
    turns: z.array(UnifiedTurnSchema),
    requests: z.array(UnifiedUserInputRequestSchema),
    createdAt: NonNegativeIntSchema.optional(),
    updatedAt: NonNegativeIntSchema.optional(),
    title: NullableStringSchema.optional(),
    latestModel: NullableStringSchema.optional(),
    latestReasoningEffort: NullableStringSchema.optional(),
    cwd: z.string().optional(),
    source: z.string().optional()
  })
  .strict();
export type UnifiedThread = z.infer<typeof UnifiedThreadSchema>;

export const UnifiedThreadSummarySchema = z
  .object({
    id: NonEmptyStringSchema,
    provider: UnifiedProviderIdSchema,
    preview: z.string(),
    createdAt: NonNegativeIntSchema,
    updatedAt: NonNegativeIntSchema,
    cwd: z.string().optional(),
    source: z.string().optional()
  })
  .strict();
export type UnifiedThreadSummary = z.infer<typeof UnifiedThreadSummarySchema>;

const UnifiedCommandListThreadsSchema = z
  .object({
    kind: z.literal("listThreads"),
    provider: UnifiedProviderIdSchema,
    limit: z.number().int().positive(),
    archived: z.boolean(),
    all: z.boolean(),
    maxPages: z.number().int().positive(),
    cursor: z.union([z.string(), z.null()]).optional()
  })
  .strict();

const UnifiedCommandCreateThreadSchema = z
  .object({
    kind: z.literal("createThread"),
    provider: UnifiedProviderIdSchema,
    cwd: z.string().optional(),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    personality: z.string().optional(),
    sandbox: z.string().optional(),
    approvalPolicy: z.string().optional(),
    ephemeral: z.boolean().optional()
  })
  .strict();

const UnifiedCommandReadThreadSchema = z
  .object({
    kind: z.literal("readThread"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema,
    includeTurns: z.boolean().optional().default(true)
  })
  .strict();

const UnifiedCommandSendMessageSchema = z
  .object({
    kind: z.literal("sendMessage"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema,
    text: z.string().min(1),
    ownerClientId: z.string().optional(),
    cwd: z.string().optional(),
    isSteering: z.boolean().optional()
  })
  .strict();

const UnifiedCommandInterruptSchema = z
  .object({
    kind: z.literal("interrupt"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema,
    ownerClientId: z.string().optional()
  })
  .strict();

const UnifiedCommandListModelsSchema = z
  .object({
    kind: z.literal("listModels"),
    provider: UnifiedProviderIdSchema,
    limit: z.number().int().positive().optional().default(200)
  })
  .strict();

const UnifiedCommandListCollaborationModesSchema = z
  .object({
    kind: z.literal("listCollaborationModes"),
    provider: UnifiedProviderIdSchema
  })
  .strict();

const UnifiedCommandSetCollaborationModeSchema = z
  .object({
    kind: z.literal("setCollaborationMode"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema,
    ownerClientId: z.string().optional(),
    collaborationMode: z
      .object({
        mode: NonEmptyStringSchema,
        settings: z
          .object({
            model: NullableStringSchema.optional(),
            reasoningEffort: NullableStringSchema.optional(),
            developerInstructions: NullableStringSchema.optional()
          })
          .strict()
      })
      .strict()
  })
  .strict();

const UnifiedCommandSubmitUserInputSchema = z
  .object({
    kind: z.literal("submitUserInput"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema,
    ownerClientId: z.string().optional(),
    requestId: UnifiedUserInputRequestIdSchema,
    response: z
      .object({
        answers: z.record(
          z
            .object({
              answers: z.array(z.string())
            })
            .strict()
        )
      })
      .strict()
  })
  .strict();

const UnifiedCommandReadLiveStateSchema = z
  .object({
    kind: z.literal("readLiveState"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema
  })
  .strict();

const UnifiedCommandReadStreamEventsSchema = z
  .object({
    kind: z.literal("readStreamEvents"),
    provider: UnifiedProviderIdSchema,
    threadId: NonEmptyStringSchema,
    limit: z.number().int().positive().optional().default(80)
  })
  .strict();

const UnifiedCommandListProjectDirectoriesSchema = z
  .object({
    kind: z.literal("listProjectDirectories"),
    provider: UnifiedProviderIdSchema
  })
  .strict();

export const UnifiedCommandSchema = z.discriminatedUnion("kind", [
  UnifiedCommandListThreadsSchema,
  UnifiedCommandCreateThreadSchema,
  UnifiedCommandReadThreadSchema,
  UnifiedCommandSendMessageSchema,
  UnifiedCommandInterruptSchema,
  UnifiedCommandListModelsSchema,
  UnifiedCommandListCollaborationModesSchema,
  UnifiedCommandSetCollaborationModeSchema,
  UnifiedCommandSubmitUserInputSchema,
  UnifiedCommandReadLiveStateSchema,
  UnifiedCommandReadStreamEventsSchema,
  UnifiedCommandListProjectDirectoriesSchema
]);

export type UnifiedCommand = z.infer<typeof UnifiedCommandSchema>;
export type UnifiedCommandKind = UnifiedCommand["kind"];

export const UNIFIED_COMMAND_KINDS = [
  "listThreads",
  "createThread",
  "readThread",
  "sendMessage",
  "interrupt",
  "listModels",
  "listCollaborationModes",
  "setCollaborationMode",
  "submitUserInput",
  "readLiveState",
  "readStreamEvents",
  "listProjectDirectories"
] as const satisfies ReadonlyArray<UnifiedCommandKind>;

const UnifiedCommandResultListThreadsSchema = z
  .object({
    kind: z.literal("listThreads"),
    data: z.array(UnifiedThreadSummarySchema),
    nextCursor: z.union([z.string(), z.null()]).optional(),
    pages: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional()
  })
  .strict();

const UnifiedCommandResultCreateThreadSchema = z
  .object({
    kind: z.literal("createThread"),
    threadId: NonEmptyStringSchema,
    thread: UnifiedThreadSchema
  })
  .strict();

const UnifiedCommandResultReadThreadSchema = z
  .object({
    kind: z.literal("readThread"),
    thread: UnifiedThreadSchema
  })
  .strict();

const UnifiedCommandResultSendMessageSchema = z
  .object({
    kind: z.literal("sendMessage")
  })
  .strict();

const UnifiedCommandResultInterruptSchema = z
  .object({
    kind: z.literal("interrupt")
  })
  .strict();

const UnifiedCommandResultListModelsSchema = z
  .object({
    kind: z.literal("listModels"),
    data: z.array(UnifiedModelSchema)
  })
  .strict();

const UnifiedCommandResultListCollaborationModesSchema = z
  .object({
    kind: z.literal("listCollaborationModes"),
    data: z.array(UnifiedCollaborationModeSchema)
  })
  .strict();

const UnifiedCommandResultSetCollaborationModeSchema = z
  .object({
    kind: z.literal("setCollaborationMode"),
    ownerClientId: z.string()
  })
  .strict();

const UnifiedCommandResultSubmitUserInputSchema = z
  .object({
    kind: z.literal("submitUserInput"),
    ownerClientId: z.string(),
    requestId: UnifiedUserInputRequestIdSchema
  })
  .strict();

const UnifiedCommandResultReadLiveStateSchema = z
  .object({
    kind: z.literal("readLiveState"),
    threadId: NonEmptyStringSchema,
    ownerClientId: z.union([z.string(), z.null()]),
    conversationState: z.union([UnifiedThreadSchema, z.null()]),
    liveStateError: z
      .union([
        z
          .object({
            kind: z.literal("reductionFailed"),
            message: z.string(),
            eventIndex: z.union([z.number().int().nonnegative(), z.null()]),
            patchIndex: z.union([z.number().int().nonnegative(), z.null()])
          })
          .strict(),
        z.null()
      ])
      .optional()
  })
  .strict();

const UnifiedCommandResultReadStreamEventsSchema = z
  .object({
    kind: z.literal("readStreamEvents"),
    threadId: NonEmptyStringSchema,
    ownerClientId: z.union([z.string(), z.null()]),
    events: z.array(JsonValueSchema)
  })
  .strict();

const UnifiedCommandResultListProjectDirectoriesSchema = z
  .object({
    kind: z.literal("listProjectDirectories"),
    directories: z.array(z.string())
  })
  .strict();

export const UnifiedCommandResultSchema = z.discriminatedUnion("kind", [
  UnifiedCommandResultListThreadsSchema,
  UnifiedCommandResultCreateThreadSchema,
  UnifiedCommandResultReadThreadSchema,
  UnifiedCommandResultSendMessageSchema,
  UnifiedCommandResultInterruptSchema,
  UnifiedCommandResultListModelsSchema,
  UnifiedCommandResultListCollaborationModesSchema,
  UnifiedCommandResultSetCollaborationModeSchema,
  UnifiedCommandResultSubmitUserInputSchema,
  UnifiedCommandResultReadLiveStateSchema,
  UnifiedCommandResultReadStreamEventsSchema,
  UnifiedCommandResultListProjectDirectoriesSchema
]);

export type UnifiedCommandResult = z.infer<typeof UnifiedCommandResultSchema>;
export type UnifiedCommandResultKind = UnifiedCommandResult["kind"];

export const UnifiedCommandErrorSchema = z
  .object({
    code: NonEmptyStringSchema,
    message: z.string(),
    details: z.union([JsonValueSchema, z.null()]).optional()
  })
  .strict();

export const UnifiedCommandResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      result: UnifiedCommandResultSchema
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: UnifiedCommandErrorSchema
    })
    .strict()
]);
export type UnifiedCommandResponse = z.infer<typeof UnifiedCommandResponseSchema>;

const UnifiedEventProviderStateSchema = z
  .object({
    kind: z.literal("providerStateChanged"),
    provider: UnifiedProviderIdSchema,
    enabled: z.boolean(),
    connected: z.boolean(),
    lastError: NullableStringSchema.optional()
  })
  .strict();

const UnifiedEventThreadUpdatedSchema = z
  .object({
    kind: z.literal("threadUpdated"),
    threadId: NonEmptyStringSchema,
    provider: UnifiedProviderIdSchema,
    thread: UnifiedThreadSchema
  })
  .strict();

const UnifiedEventUserInputRequestedSchema = z
  .object({
    kind: z.literal("userInputRequested"),
    threadId: NonEmptyStringSchema,
    request: UnifiedUserInputRequestSchema
  })
  .strict();

const UnifiedEventUserInputResolvedSchema = z
  .object({
    kind: z.literal("userInputResolved"),
    threadId: NonEmptyStringSchema,
    requestId: UnifiedUserInputRequestIdSchema
  })
  .strict();

const UnifiedEventErrorSchema = z
  .object({
    kind: z.literal("error"),
    message: z.string(),
    code: z.string().optional(),
    details: z.union([JsonValueSchema, z.null()]).optional()
  })
  .strict();

export const UnifiedEventSchema = z.discriminatedUnion("kind", [
  UnifiedEventProviderStateSchema,
  UnifiedEventThreadUpdatedSchema,
  UnifiedEventUserInputRequestedSchema,
  UnifiedEventUserInputResolvedSchema,
  UnifiedEventErrorSchema
]);

export type UnifiedEvent = z.infer<typeof UnifiedEventSchema>;
export type UnifiedEventKind = UnifiedEvent["kind"];

export const UNIFIED_EVENT_KINDS = [
  "providerStateChanged",
  "threadUpdated",
  "userInputRequested",
  "userInputResolved",
  "error"
] as const satisfies ReadonlyArray<UnifiedEventKind>;

type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

const COMMAND_KIND_COVERAGE: Record<UnifiedCommandKind, true> = {
  listThreads: true,
  createThread: true,
  readThread: true,
  sendMessage: true,
  interrupt: true,
  listModels: true,
  listCollaborationModes: true,
  setCollaborationMode: true,
  submitUserInput: true,
  readLiveState: true,
  readStreamEvents: true,
  listProjectDirectories: true
};

const COMMAND_RESULT_KIND_COVERAGE: Record<UnifiedCommandResultKind, true> = {
  listThreads: true,
  createThread: true,
  readThread: true,
  sendMessage: true,
  interrupt: true,
  listModels: true,
  listCollaborationModes: true,
  setCollaborationMode: true,
  submitUserInput: true,
  readLiveState: true,
  readStreamEvents: true,
  listProjectDirectories: true
};

const ITEM_KIND_COVERAGE: Record<UnifiedItemKind, true> = {
  userMessage: true,
  steeringUserMessage: true,
  agentMessage: true,
  error: true,
  reasoning: true,
  plan: true,
  planImplementation: true,
  userInputResponse: true,
  commandExecution: true,
  fileChange: true,
  contextCompaction: true,
  webSearch: true,
  mcpToolCall: true,
  collabAgentToolCall: true,
  imageView: true,
  enteredReviewMode: true,
  exitedReviewMode: true,
  modelChanged: true
};

const FEATURE_ID_COVERAGE: Record<UnifiedFeatureId, true> = {
  listThreads: true,
  createThread: true,
  readThread: true,
  sendMessage: true,
  interrupt: true,
  listModels: true,
  listCollaborationModes: true,
  setCollaborationMode: true,
  submitUserInput: true,
  readLiveState: true,
  readStreamEvents: true,
  listProjectDirectories: true
};

const EVENT_KIND_COVERAGE: Record<UnifiedEventKind, true> = {
  providerStateChanged: true,
  threadUpdated: true,
  userInputRequested: true,
  userInputResolved: true,
  error: true
};

type MissingCommandKinds = Exclude<UnifiedCommandKind, keyof typeof COMMAND_KIND_COVERAGE>;
type MissingCommandResultKinds = Exclude<UnifiedCommandResultKind, keyof typeof COMMAND_RESULT_KIND_COVERAGE>;
type MissingItemKinds = Exclude<UnifiedItemKind, keyof typeof ITEM_KIND_COVERAGE>;
type MissingFeatureIds = Exclude<UnifiedFeatureId, keyof typeof FEATURE_ID_COVERAGE>;
type MissingEventKinds = Exclude<UnifiedEventKind, keyof typeof EVENT_KIND_COVERAGE>;

type _AssertNoMissingCommandKinds = AssertTrue<IsNever<MissingCommandKinds>>;
type _AssertNoMissingCommandResultKinds = AssertTrue<IsNever<MissingCommandResultKinds>>;
type _AssertNoMissingItemKinds = AssertTrue<IsNever<MissingItemKinds>>;
type _AssertNoMissingFeatureIds = AssertTrue<IsNever<MissingFeatureIds>>;
type _AssertNoMissingEventKinds = AssertTrue<IsNever<MissingEventKinds>>;

void (
  {
    commandKinds: UNIFIED_COMMAND_KINDS,
    itemKinds: UNIFIED_ITEM_KINDS,
    featureIds: UNIFIED_FEATURE_IDS,
    eventKinds: UNIFIED_EVENT_KINDS,
    commandCoverage: COMMAND_KIND_COVERAGE,
    commandResultCoverage: COMMAND_RESULT_KIND_COVERAGE,
    itemCoverage: ITEM_KIND_COVERAGE,
    featureCoverage: FEATURE_ID_COVERAGE,
    eventCoverage: EVENT_KIND_COVERAGE
  }
);
