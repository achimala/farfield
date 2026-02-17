import { z } from "zod";
import { ProtocolValidationError } from "@codex-monitor/codex-protocol";

export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.number().int().nonnegative(),
    method: z.string().min(1),
    params: z.unknown().optional()
  })
  .strict();

export const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.number().int().nonnegative(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string(),
        data: z.unknown().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export function parseJsonRpcResponse(value: unknown): JsonRpcResponse {
  const parsed = JsonRpcResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw ProtocolValidationError.fromZod("JsonRpcResponse", parsed.error);
  }
  return parsed.data;
}
