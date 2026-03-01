// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/stable/json/v2/ThreadStartResponse.json
import { z } from "zod"

export const ThreadStartResponseSchema = z.object({ "approvalPolicy": z.any().superRefine((x, ctx) => {
    const schemas = [z.enum(["untrusted","on-failure","on-request","never"]), z.object({ "reject": z.object({ "mcp_elicitations": z.boolean(), "rules": z.boolean(), "sandbox_approval": z.boolean() }) }).strict()];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }), "cwd": z.string(), "model": z.string(), "modelProvider": z.string(), "reasoningEffort": z.union([z.enum(["none","minimal","low","medium","high","xhigh"]).describe("See https://platform.openai.com/docs/guides/reasoning?api-mode=responses#get-started-with-reasoning"), z.null()]).optional(), "sandbox": z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "type": z.literal("dangerFullAccess") }), z.object({ "access": z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "includePlatformDefaults": z.boolean().default(true), "readableRoots": z.array(z.string().describe("A path that is guaranteed to be absolute and normalized (though it is not guaranteed to be canonicalized or exist on the filesystem).\n\nIMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set using [AbsolutePathBufGuard::new]. If no base path is set, the deserialization will fail unless the path being deserialized is already absolute.")).default([]), "type": z.literal("restricted") }), z.object({ "type": z.literal("fullAccess") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }).default({"type":"fullAccess"}), "type": z.literal("readOnly") }), z.object({ "networkAccess": z.enum(["restricted","enabled"]).default("restricted"), "type": z.literal("externalSandbox") }), z.object({ "excludeSlashTmp": z.boolean().default(false), "excludeTmpdirEnvVar": z.boolean().default(false), "networkAccess": z.boolean().default(false), "readOnlyAccess": z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "includePlatformDefaults": z.boolean().default(true), "readableRoots": z.array(z.string().describe("A path that is guaranteed to be absolute and normalized (though it is not guaranteed to be canonicalized or exist on the filesystem).\n\nIMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set using [AbsolutePathBufGuard::new]. If no base path is set, the deserialization will fail unless the path being deserialized is already absolute.")).default([]), "type": z.literal("restricted") }), z.object({ "type": z.literal("fullAccess") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }).default({"type":"fullAccess"}), "type": z.literal("workspaceWrite"), "writableRoots": z.array(z.string().describe("A path that is guaranteed to be absolute and normalized (though it is not guaranteed to be canonicalized or exist on the filesystem).\n\nIMPORTANT: When deserializing an `AbsolutePathBuf`, a base path must be set using [AbsolutePathBufGuard::new]. If no base path is set, the deserialization will fail unless the path being deserialized is already absolute.")).default([]) })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }), "thread": z.object({ "agentNickname": z.union([z.string().describe("Optional random unique nickname assigned to an AgentControl-spawned sub-agent."), z.null().describe("Optional random unique nickname assigned to an AgentControl-spawned sub-agent.")]).describe("Optional random unique nickname assigned to an AgentControl-spawned sub-agent.").optional(), "agentRole": z.union([z.string().describe("Optional role (agent_role) assigned to an AgentControl-spawned sub-agent."), z.null().describe("Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.")]).describe("Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.").optional(), "cliVersion": z.string().describe("Version of the CLI that created the thread."), "createdAt": z.number().int().describe("Unix timestamp (in seconds) when the thread was created."), "cwd": z.string().describe("Working directory captured for the thread."), "gitInfo": z.union([z.object({ "branch": z.union([z.string(), z.null()]).optional(), "originUrl": z.union([z.string(), z.null()]).optional(), "sha": z.union([z.string(), z.null()]).optional() }), z.null()]).describe("Optional Git metadata captured when the thread was created.").optional(), "id": z.string(), "modelProvider": z.string().describe("Model provider used for this thread (for example, 'openai')."), "name": z.union([z.string().describe("Optional user-facing thread title."), z.null().describe("Optional user-facing thread title.")]).describe("Optional user-facing thread title.").optional(), "path": z.union([z.string().describe("[UNSTABLE] Path to the thread on disk."), z.null().describe("[UNSTABLE] Path to the thread on disk.")]).describe("[UNSTABLE] Path to the thread on disk.").optional(), "preview": z.string().describe("Usually the first user message in the thread, if available."), "source": z.any().superRefine((x, ctx) => {
    const schemas = [z.enum(["cli","vscode","exec","appServer","unknown"]), z.object({ "subAgent": z.any().superRefine((x, ctx) => {
    const schemas = [z.enum(["review","compact","memory_consolidation"]), z.object({ "thread_spawn": z.object({ "agent_nickname": z.union([z.string(), z.null()]).default(null), "agent_role": z.union([z.string(), z.null()]).default(null), "depth": z.number().int(), "parent_thread_id": z.string() }) }).strict(), z.object({ "other": z.string() }).strict()];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }) }).strict()];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }).describe("Origin of the thread (CLI, VSCode, codex exec, codex app-server, etc.)."), "status": z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "type": z.literal("notLoaded") }), z.object({ "type": z.literal("idle") }), z.object({ "type": z.literal("systemError") }), z.object({ "activeFlags": z.array(z.enum(["waitingOnApproval","waitingOnUserInput"])), "type": z.literal("active") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }).describe("Current runtime status for the thread."), "turns": z.array(z.object({ "error": z.union([z.object({ "additionalDetails": z.union([z.string(), z.null()]).default(null), "codexErrorInfo": z.union([z.any().superRefine((x, ctx) => {
    const schemas = [z.enum(["contextWindowExceeded","usageLimitExceeded","serverOverloaded","internalServerError","unauthorized","badRequest","threadRollbackFailed","sandboxError","other"]), z.object({ "httpConnectionFailed": z.object({ "httpStatusCode": z.union([z.number().int().gte(0), z.null()]).optional() }) }).strict(), z.object({ "responseStreamConnectionFailed": z.object({ "httpStatusCode": z.union([z.number().int().gte(0), z.null()]).optional() }) }).strict().describe("Failed to connect to the response SSE stream."), z.object({ "responseStreamDisconnected": z.object({ "httpStatusCode": z.union([z.number().int().gte(0), z.null()]).optional() }) }).strict().describe("The response SSE stream disconnected in the middle of a turn before completion."), z.object({ "responseTooManyFailedAttempts": z.object({ "httpStatusCode": z.union([z.number().int().gte(0), z.null()]).optional() }) }).strict().describe("Reached the retry limit for responses.")];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }).describe("This translation layer make sure that we expose codex error code in camel case.\n\nWhen an upstream HTTP status is available (for example, from the Responses API or a provider), it is forwarded in `httpStatusCode` on the relevant `codexErrorInfo` variant."), z.null()]).optional(), "message": z.string() }), z.null()]).describe("Only populated when the Turn's status is failed.").optional(), "id": z.string(), "items": z.array(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "content": z.array(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "text": z.string(), "text_elements": z.array(z.object({ "byteRange": z.object({ "end": z.number().int().gte(0), "start": z.number().int().gte(0) }).describe("Byte range in the parent `text` buffer that this element occupies."), "placeholder": z.union([z.string().describe("Optional human-readable placeholder for the element, displayed in the UI."), z.null().describe("Optional human-readable placeholder for the element, displayed in the UI.")]).describe("Optional human-readable placeholder for the element, displayed in the UI.").optional() })).describe("UI-defined spans within `text` used to render or persist special elements.").default([]), "type": z.literal("text") }), z.object({ "type": z.literal("image"), "url": z.string() }), z.object({ "path": z.string(), "type": z.literal("localImage") }), z.object({ "name": z.string(), "path": z.string(), "type": z.literal("skill") }), z.object({ "name": z.string(), "path": z.string(), "type": z.literal("mention") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  })), "id": z.string(), "type": z.literal("userMessage") }), z.object({ "id": z.string(), "phase": z.union([z.any().superRefine((x, ctx) => {
    const schemas = [z.literal("commentary").describe("Mid-turn assistant text (for example preamble/progress narration).\n\nAdditional tool calls or assistant output may follow before turn completion."), z.literal("final_answer").describe("The assistant's terminal answer text for the current turn.")];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }).describe("Classifies an assistant message as interim commentary or final answer text.\n\nProviders do not emit this consistently, so callers must treat `None` as \"phase unknown\" and keep compatibility behavior for legacy models."), z.null()]).default(null), "text": z.string(), "type": z.literal("agentMessage") }), z.object({ "id": z.string(), "text": z.string(), "type": z.literal("plan") }).describe("EXPERIMENTAL - proposed plan item content. The completed plan item is authoritative and may not match the concatenation of `PlanDelta` text."), z.object({ "content": z.array(z.string()).default([]), "id": z.string(), "summary": z.array(z.string()).default([]), "type": z.literal("reasoning") }), z.object({ "aggregatedOutput": z.union([z.string().describe("The command's output, aggregated from stdout and stderr."), z.null().describe("The command's output, aggregated from stdout and stderr.")]).describe("The command's output, aggregated from stdout and stderr.").optional(), "command": z.string().describe("The command to be executed."), "commandActions": z.array(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "command": z.string(), "name": z.string(), "path": z.string(), "type": z.literal("read") }), z.object({ "command": z.string(), "path": z.union([z.string(), z.null()]).optional(), "type": z.literal("listFiles") }), z.object({ "command": z.string(), "path": z.union([z.string(), z.null()]).optional(), "query": z.union([z.string(), z.null()]).optional(), "type": z.literal("search") }), z.object({ "command": z.string(), "type": z.literal("unknown") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  })).describe("A best-effort parsing of the command to understand the action(s) it will perform. This returns a list of CommandAction objects because a single shell command may be composed of many commands piped together."), "cwd": z.string().describe("The command's working directory."), "durationMs": z.union([z.number().int().describe("The duration of the command execution in milliseconds."), z.null().describe("The duration of the command execution in milliseconds.")]).describe("The duration of the command execution in milliseconds.").optional(), "exitCode": z.union([z.number().int().describe("The command's exit code."), z.null().describe("The command's exit code.")]).describe("The command's exit code.").optional(), "id": z.string(), "processId": z.union([z.string().describe("Identifier for the underlying PTY process (when available)."), z.null().describe("Identifier for the underlying PTY process (when available).")]).describe("Identifier for the underlying PTY process (when available).").optional(), "status": z.enum(["inProgress","completed","failed","declined"]), "type": z.literal("commandExecution") }), z.object({ "changes": z.array(z.object({ "diff": z.string(), "kind": z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "type": z.literal("add") }), z.object({ "type": z.literal("delete") }), z.object({ "move_path": z.union([z.string(), z.null()]).optional(), "type": z.literal("update") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }), "path": z.string() })), "id": z.string(), "status": z.enum(["inProgress","completed","failed","declined"]), "type": z.literal("fileChange") }), z.object({ "arguments": z.any(), "durationMs": z.union([z.number().int().describe("The duration of the MCP tool call in milliseconds."), z.null().describe("The duration of the MCP tool call in milliseconds.")]).describe("The duration of the MCP tool call in milliseconds.").optional(), "error": z.union([z.object({ "message": z.string() }), z.null()]).optional(), "id": z.string(), "result": z.union([z.object({ "content": z.array(z.any()), "structuredContent": z.any().optional() }), z.null()]).optional(), "server": z.string(), "status": z.enum(["inProgress","completed","failed"]), "tool": z.string(), "type": z.literal("mcpToolCall") }), z.object({ "arguments": z.any(), "contentItems": z.union([z.array(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "text": z.string(), "type": z.literal("inputText") }), z.object({ "imageUrl": z.string(), "type": z.literal("inputImage") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  })), z.null()]).optional(), "durationMs": z.union([z.number().int().describe("The duration of the dynamic tool call in milliseconds."), z.null().describe("The duration of the dynamic tool call in milliseconds.")]).describe("The duration of the dynamic tool call in milliseconds.").optional(), "id": z.string(), "status": z.enum(["inProgress","completed","failed"]), "success": z.union([z.boolean(), z.null()]).optional(), "tool": z.string(), "type": z.literal("dynamicToolCall") }), z.object({ "agentsStates": z.record(z.object({ "message": z.union([z.string(), z.null()]).optional(), "status": z.enum(["pendingInit","running","completed","errored","shutdown","notFound"]) })).describe("Last known status of the target agents, when available."), "id": z.string().describe("Unique identifier for this collab tool call."), "prompt": z.union([z.string().describe("Prompt text sent as part of the collab tool call, when available."), z.null().describe("Prompt text sent as part of the collab tool call, when available.")]).describe("Prompt text sent as part of the collab tool call, when available.").optional(), "receiverThreadIds": z.array(z.string()).describe("Thread ID of the receiving agent, when applicable. In case of spawn operation, this corresponds to the newly spawned agent."), "senderThreadId": z.string().describe("Thread ID of the agent issuing the collab request."), "status": z.enum(["inProgress","completed","failed"]).describe("Current status of the collab tool call."), "tool": z.enum(["spawnAgent","sendInput","resumeAgent","wait","closeAgent"]).describe("Name of the collab tool that was invoked."), "type": z.literal("collabAgentToolCall") }), z.object({ "action": z.union([z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "queries": z.union([z.array(z.string()), z.null()]).optional(), "query": z.union([z.string(), z.null()]).optional(), "type": z.literal("search") }), z.object({ "type": z.literal("openPage"), "url": z.union([z.string(), z.null()]).optional() }), z.object({ "pattern": z.union([z.string(), z.null()]).optional(), "type": z.literal("findInPage"), "url": z.union([z.string(), z.null()]).optional() }), z.object({ "type": z.literal("other") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  }), z.null()]).optional(), "id": z.string(), "query": z.string(), "type": z.literal("webSearch") }), z.object({ "id": z.string(), "path": z.string(), "type": z.literal("imageView") }), z.object({ "id": z.string(), "review": z.string(), "type": z.literal("enteredReviewMode") }), z.object({ "id": z.string(), "review": z.string(), "type": z.literal("exitedReviewMode") }), z.object({ "id": z.string(), "type": z.literal("contextCompaction") })];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  })).describe("Only populated on a `thread/resume` or `thread/fork` response. For all other responses and notifications returning a Turn, the items field will be an empty list."), "status": z.enum(["completed","interrupted","failed","inProgress"]) })).describe("Only populated on `thread/resume`, `thread/rollback`, `thread/fork`, and `thread/read` (when `includeTurns` is true) responses. For all other responses and notifications returning a Thread, the turns field will be an empty list."), "updatedAt": z.number().int().describe("Unix timestamp (in seconds) when the thread was last updated.") }) })
