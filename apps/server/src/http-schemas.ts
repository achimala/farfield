import { z } from "zod";

export const TraceStartBodySchema = z
  .object({
    label: z.string().min(1).max(120),
  })
  .strict();

export const TraceMarkBodySchema = z
  .object({
    note: z.string().max(500),
  })
  .strict();

export const AgentScopedQuerySchema = z
  .object({
    agentId: z.enum(["codex", "opencode"]).optional()
  })
  .strict();

export function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
): z.infer<Schema> {
  return schema.parse(value);
}

export function parseQuery<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.infer<Schema> {
  return schema.parse(value);
}
