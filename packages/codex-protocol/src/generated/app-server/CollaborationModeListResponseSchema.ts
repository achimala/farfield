// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/experimental/json/v2/CollaborationModeListResponse.json
import { z } from "zod"

export const CollaborationModeListResponseSchema = z.object({ "data": z.array(z.object({ "mode": z.union([z.enum(["plan","default"]).describe("Initial collaboration mode to use when the TUI starts."), z.null()]).optional(), "model": z.union([z.string(), z.null()]).optional(), "name": z.string(), "reasoning_effort": z.union([z.union([z.enum(["none","minimal","low","medium","high","xhigh"]).describe("See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#get-started-with-reasoning"), z.null()]), z.null()]).optional() }).describe("EXPERIMENTAL - collaboration mode preset metadata for clients.")) }).describe("EXPERIMENTAL - collaboration mode presets response.")
