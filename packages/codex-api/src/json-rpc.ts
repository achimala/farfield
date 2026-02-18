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
    jsonrpc: z.literal("2.0").optional(),
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
  .strict()
  .superRefine((value, context) => {
    if (value.result === undefined && value.error === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Response must include either result or error"
      });
    }
  });

export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

export function parseJsonRpcResponse(value: unknown): JsonRpcResponse {
  const parsed = JsonRpcResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw ProtocolValidationError.fromZod("JsonRpcResponse", parsed.error);
  }
  return parsed.data;
}

export const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    method: z.string().min(1),
    params: z.unknown().optional()
  })
  .strict();

export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

export type JsonRpcIncomingMessage =
  | { kind: "response"; value: JsonRpcResponse }
  | { kind: "notification"; value: JsonRpcNotification };

export function parseJsonRpcIncomingMessage(value: unknown): JsonRpcIncomingMessage {
  const parsed = z.union([JsonRpcResponseSchema, JsonRpcNotificationSchema]).safeParse(value);
  if (!parsed.success) {
    throw ProtocolValidationError.fromZod("JsonRpcIncomingMessage", parsed.error);
  }

  if ("id" in parsed.data) {
    return {
      kind: "response",
      value: parsed.data
    };
  }

  return {
    kind: "notification",
    value: parsed.data
  };
}
