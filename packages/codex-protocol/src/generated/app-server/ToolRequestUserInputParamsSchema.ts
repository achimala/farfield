// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/stable/json/ToolRequestUserInputParams.json
import { z } from "zod"

export const ToolRequestUserInputParamsSchema = z.object({ "itemId": z.string(), "questions": z.array(z.object({ "header": z.string(), "id": z.string(), "isOther": z.boolean().default(false), "isSecret": z.boolean().default(false), "options": z.union([z.array(z.object({ "description": z.string(), "label": z.string() }).describe("EXPERIMENTAL. Defines a single selectable option for request_user_input.")), z.null()]).optional(), "question": z.string() }).describe("EXPERIMENTAL. Represents one request_user_input question and its required options.")), "threadId": z.string(), "turnId": z.string() }).describe("EXPERIMENTAL. Params sent with a request_user_input event.")
