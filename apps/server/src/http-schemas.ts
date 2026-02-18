import { CollaborationModeSchema } from "@farfield/protocol";
import { z } from "zod";

export const SetModeBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    collaborationMode: CollaborationModeSchema
  })
  .passthrough();

export const StartThreadBodySchema = z
  .object({
    cwd: z.string().optional(),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    personality: z.string().optional(),
    sandbox: z.string().optional(),
    approvalPolicy: z.string().optional(),
    ephemeral: z.boolean().optional()
  })
  .passthrough();

export const SendMessageBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    text: z.string().min(1),
    cwd: z.string().optional(),
    isSteering: z.boolean().optional()
  })
  .passthrough();

export const SubmitUserInputBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    requestId: z.number().int().nonnegative(),
    response: z.unknown()
  })
  .passthrough();

export const InterruptBodySchema = z
  .object({
    ownerClientId: z.string().optional()
  })
  .passthrough();

export const TraceStartBodySchema = z
  .object({
    label: z.string().min(1).max(120)
  })
  .passthrough();

export const TraceMarkBodySchema = z
  .object({
    note: z.string().max(500)
  })
  .passthrough();

export const ReplayBodySchema = z
  .object({
    entryId: z.string().min(1),
    waitForResponse: z.boolean().optional()
  })
  .passthrough();

export function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.infer<Schema> {
  return schema.parse(value);
}
