import { z } from "zod";

export const NonEmptyStringSchema = z.string().min(1);
export const NullableNonEmptyStringSchema = z.union([NonEmptyStringSchema, z.null()]);
export const NullableStringSchema = z.union([z.string(), z.null()]);
export const NonNegativeIntSchema = z.number().int().nonnegative();

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonPrimitive = z.infer<typeof JsonPrimitiveSchema>;

export const JsonValueSchema: z.ZodType<
  JsonPrimitive | { [key: string]: unknown } | unknown[]
> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(JsonValueSchema)])
);

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
