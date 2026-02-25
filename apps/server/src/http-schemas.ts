import { CollaborationModeSchema, UserInputResponsePayloadSchema } from "@farfield/protocol";
import { z } from "zod";

export const SetModeBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    collaborationMode: CollaborationModeSchema
  })
  .strict();

export const StartThreadBodySchema = z
  .object({
    agentId: z.enum(["codex", "opencode"]).optional(),
    cwd: z.string().optional(),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    personality: z.string().optional(),
    sandbox: z.string().optional(),
    approvalPolicy: z.string().optional(),
    ephemeral: z.boolean().optional()
  })
  .strict();

export const SendMessageBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    text: z.string().min(1),
    cwd: z.string().optional(),
    isSteering: z.boolean().optional()
  })
  .strict();

export const SubmitUserInputBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    requestId: z.number().int().nonnegative(),
    response: UserInputResponsePayloadSchema
  })
  .strict();

export const InterruptBodySchema = z
  .object({
    ownerClientId: z.string().optional()
  })
  .strict();

export const TraceStartBodySchema = z
  .object({
    label: z.string().min(1).max(120)
  })
  .strict();

export const TraceMarkBodySchema = z
  .object({
    note: z.string().max(500)
  })
  .strict();

export const ReplayBodySchema = z
  .object({
    entryId: z.string().min(1),
    waitForResponse: z.boolean().optional()
  })
  .strict();

export const AgentScopedQuerySchema = z
  .object({
    agentId: z.enum(["codex", "opencode"]).optional()
  })
  .strict();

export function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.infer<Schema> {
  return schema.parse(value);
}

export function parseQuery<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.infer<Schema> {
  return schema.parse(value);
}
