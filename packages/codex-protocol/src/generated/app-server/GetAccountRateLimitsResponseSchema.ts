// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/stable/json/v2/GetAccountRateLimitsResponse.json
import { z } from "zod";

const RateLimitWindowSchema = z
  .object({
    resetsAt: z.union([z.number().int(), z.null()]).optional(),
    usedPercent: z.number().int(),
    windowDurationMins: z.union([z.number().int(), z.null()]).optional()
  })
  .passthrough();

const CreditsSnapshotSchema = z
  .object({
    balance: z.union([z.string(), z.null()]).optional(),
    hasCredits: z.boolean(),
    unlimited: z.boolean()
  })
  .passthrough();

const RateLimitSnapshotSchema = z
  .object({
    credits: z.union([CreditsSnapshotSchema, z.null()]).optional(),
    limitId: z.union([z.string(), z.null()]).optional(),
    limitName: z.union([z.string(), z.null()]).optional(),
    planType: z
      .union([
        z.enum(["free", "go", "plus", "pro", "team", "business", "enterprise", "edu", "unknown"]),
        z.null()
      ])
      .optional(),
    primary: z.union([RateLimitWindowSchema, z.null()]).optional(),
    secondary: z.union([RateLimitWindowSchema, z.null()]).optional()
  })
  .passthrough();

export const GetAccountRateLimitsResponseSchema = z
  .object({
    rateLimits: RateLimitSnapshotSchema,
    rateLimitsByLimitId: z.record(RateLimitSnapshotSchema).nullable().optional()
  })
  .passthrough();
