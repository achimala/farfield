// GENERATED FILE. DO NOT EDIT.
// Source: vendor/codex-app-server-schema/experimental/json/ServerRequest.json
import { z } from "zod"

export const ExperimentalServerRequestSchema = z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("item/commandExecution/requestApproval"), "params": z.object({ "additionalPermissions": z.union([z.object({ "fileSystem": z.union([z.object({ "read": z.union([z.array(z.string()), z.null()]).optional(), "write": z.union([z.array(z.string()), z.null()]).optional() }), z.null()]).optional(), "macos": z.union([z.object({ "accessibility": z.union([z.boolean(), z.null()]).optional(), "automations": z.union([z.union([z.boolean(), z.array(z.string())]), z.null()]).optional(), "calendar": z.union([z.boolean(), z.null()]).optional(), "preferences": z.union([z.union([z.boolean(), z.string()]), z.null()]).optional() }), z.null()]).optional(), "network": z.union([z.boolean(), z.null()]).optional() }), z.null()]).describe("Optional additional permissions requested for this command.").optional(), "approvalId": z.union([z.string().describe("Unique identifier for this specific approval callback.\n\nFor regular shell/unified_exec approvals, this is null.\n\nFor zsh-exec-bridge subcommand approvals, multiple callbacks can belong to one parent `itemId`, so `approvalId` is a distinct opaque callback id (a UUID) used to disambiguate routing."), z.null().describe("Unique identifier for this specific approval callback.\n\nFor regular shell/unified_exec approvals, this is null.\n\nFor zsh-exec-bridge subcommand approvals, multiple callbacks can belong to one parent `itemId`, so `approvalId` is a distinct opaque callback id (a UUID) used to disambiguate routing.")]).describe("Unique identifier for this specific approval callback.\n\nFor regular shell/unified_exec approvals, this is null.\n\nFor zsh-exec-bridge subcommand approvals, multiple callbacks can belong to one parent `itemId`, so `approvalId` is a distinct opaque callback id (a UUID) used to disambiguate routing.").optional(), "availableDecisions": z.union([z.array(z.any().superRefine((x, ctx) => {
    const schemas = [z.literal("accept").describe("User approved the command."), z.literal("acceptForSession").describe("User approved the command and future prompts in the same session-scoped approval cache should run without prompting."), z.object({ "acceptWithExecpolicyAmendment": z.object({ "execpolicy_amendment": z.array(z.string()) }) }).strict().describe("User approved the command, and wants to apply the proposed execpolicy amendment so future matching commands can run without prompting."), z.object({ "applyNetworkPolicyAmendment": z.object({ "network_policy_amendment": z.object({ "action": z.enum(["allow","deny"]), "host": z.string() }) }) }).strict().describe("User chose a persistent network policy rule (allow/deny) for this host."), z.literal("decline").describe("User denied the command. The agent will continue the turn."), z.literal("cancel").describe("User denied the command. The turn will also be immediately interrupted.")];
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
  })).describe("Ordered list of decisions the client may present for this prompt."), z.null().describe("Ordered list of decisions the client may present for this prompt.")]).describe("Ordered list of decisions the client may present for this prompt.").optional(), "command": z.union([z.string().describe("The command to be executed."), z.null().describe("The command to be executed.")]).describe("The command to be executed.").optional(), "commandActions": z.union([z.array(z.any().superRefine((x, ctx) => {
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
  })).describe("Best-effort parsed command actions for friendly display."), z.null().describe("Best-effort parsed command actions for friendly display.")]).describe("Best-effort parsed command actions for friendly display.").optional(), "cwd": z.union([z.string().describe("The command's working directory."), z.null().describe("The command's working directory.")]).describe("The command's working directory.").optional(), "itemId": z.string(), "networkApprovalContext": z.union([z.object({ "host": z.string(), "protocol": z.enum(["http","https","socks5Tcp","socks5Udp"]) }), z.null()]).describe("Optional context for a managed-network approval prompt.").optional(), "proposedExecpolicyAmendment": z.union([z.array(z.string()).describe("Optional proposed execpolicy amendment to allow similar commands without prompting."), z.null().describe("Optional proposed execpolicy amendment to allow similar commands without prompting.")]).describe("Optional proposed execpolicy amendment to allow similar commands without prompting.").optional(), "proposedNetworkPolicyAmendments": z.union([z.array(z.object({ "action": z.enum(["allow","deny"]), "host": z.string() })).describe("Optional proposed network policy amendments (allow/deny host) for future requests."), z.null().describe("Optional proposed network policy amendments (allow/deny host) for future requests.")]).describe("Optional proposed network policy amendments (allow/deny host) for future requests.").optional(), "reason": z.union([z.string().describe("Optional explanatory reason (e.g. request for network access)."), z.null().describe("Optional explanatory reason (e.g. request for network access).")]).describe("Optional explanatory reason (e.g. request for network access).").optional(), "threadId": z.string(), "turnId": z.string() }) }).describe("NEW APIs Sent when approval is requested for a specific command execution. This request is used for Turns started via turn/start."), z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("item/fileChange/requestApproval"), "params": z.object({ "grantRoot": z.union([z.string().describe("[UNSTABLE] When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today)."), z.null().describe("[UNSTABLE] When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today).")]).describe("[UNSTABLE] When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today).").optional(), "itemId": z.string(), "reason": z.union([z.string().describe("Optional explanatory reason (e.g. request for extra write access)."), z.null().describe("Optional explanatory reason (e.g. request for extra write access).")]).describe("Optional explanatory reason (e.g. request for extra write access).").optional(), "threadId": z.string(), "turnId": z.string() }) }).describe("Sent when approval is requested for a specific file change. This request is used for Turns started via turn/start."), z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("item/tool/requestUserInput"), "params": z.object({ "itemId": z.string(), "questions": z.array(z.object({ "header": z.string(), "id": z.string(), "isOther": z.boolean().default(false), "isSecret": z.boolean().default(false), "options": z.union([z.array(z.object({ "description": z.string(), "label": z.string() }).describe("EXPERIMENTAL. Defines a single selectable option for request_user_input.")), z.null()]).optional(), "question": z.string() }).describe("EXPERIMENTAL. Represents one request_user_input question and its required options.")), "threadId": z.string(), "turnId": z.string() }).describe("EXPERIMENTAL. Params sent with a request_user_input event.") }).describe("EXPERIMENTAL - Request input from the user for a tool call."), z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("item/tool/call"), "params": z.object({ "arguments": z.any(), "callId": z.string(), "threadId": z.string(), "tool": z.string(), "turnId": z.string() }) }).describe("Execute a dynamic tool call on the client."), z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("account/chatgptAuthTokens/refresh"), "params": z.object({ "previousAccountId": z.union([z.string().describe("Workspace/account identifier that Codex was previously using.\n\nClients that manage multiple accounts/workspaces can use this as a hint to refresh the token for the correct workspace.\n\nThis may be `null` when the prior auth state did not include a workspace identifier (`chatgpt_account_id`)."), z.null().describe("Workspace/account identifier that Codex was previously using.\n\nClients that manage multiple accounts/workspaces can use this as a hint to refresh the token for the correct workspace.\n\nThis may be `null` when the prior auth state did not include a workspace identifier (`chatgpt_account_id`).")]).describe("Workspace/account identifier that Codex was previously using.\n\nClients that manage multiple accounts/workspaces can use this as a hint to refresh the token for the correct workspace.\n\nThis may be `null` when the prior auth state did not include a workspace identifier (`chatgpt_account_id`).").optional(), "reason": z.literal("unauthorized").describe("Codex attempted a backend request and received `401 Unauthorized`.") }) }), z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("applyPatchApproval"), "params": z.object({ "callId": z.string().describe("Use to correlate this with [codex_protocol::protocol::PatchApplyBeginEvent] and [codex_protocol::protocol::PatchApplyEndEvent]."), "conversationId": z.string(), "fileChanges": z.record(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "content": z.string(), "type": z.literal("add") }), z.object({ "content": z.string(), "type": z.literal("delete") }), z.object({ "move_path": z.union([z.string(), z.null()]).optional(), "type": z.literal("update"), "unified_diff": z.string() })];
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
  })), "grantRoot": z.union([z.string().describe("When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today)."), z.null().describe("When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today).")]).describe("When set, the agent is asking the user to allow writes under this root for the remainder of the session (unclear if this is honored today).").optional(), "reason": z.union([z.string().describe("Optional explanatory reason (e.g. request for extra write access)."), z.null().describe("Optional explanatory reason (e.g. request for extra write access).")]).describe("Optional explanatory reason (e.g. request for extra write access).").optional() }) }).describe("DEPRECATED APIs below Request to approve a patch. This request is used for Turns started via the legacy APIs (i.e. SendUserTurn, SendUserMessage)."), z.object({ "id": z.union([z.string(), z.number().int()]), "method": z.literal("execCommandApproval"), "params": z.object({ "approvalId": z.union([z.string().describe("Identifier for this specific approval callback."), z.null().describe("Identifier for this specific approval callback.")]).describe("Identifier for this specific approval callback.").optional(), "callId": z.string().describe("Use to correlate this with [codex_protocol::protocol::ExecCommandBeginEvent] and [codex_protocol::protocol::ExecCommandEndEvent]."), "command": z.array(z.string()), "conversationId": z.string(), "cwd": z.string(), "parsedCmd": z.array(z.any().superRefine((x, ctx) => {
    const schemas = [z.object({ "cmd": z.string(), "name": z.string(), "path": z.string().describe("(Best effort) Path to the file being read by the command. When possible, this is an absolute path, though when relative, it should be resolved against the `cwd`` that will be used to run the command to derive the absolute path."), "type": z.literal("read") }), z.object({ "cmd": z.string(), "path": z.union([z.string(), z.null()]).optional(), "type": z.literal("list_files") }), z.object({ "cmd": z.string(), "path": z.union([z.string(), z.null()]).optional(), "query": z.union([z.string(), z.null()]).optional(), "type": z.literal("search") }), z.object({ "cmd": z.string(), "type": z.literal("unknown") })];
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
  })), "reason": z.union([z.string(), z.null()]).optional() }) }).describe("Request to exec a command. This request is used for Turns started via the legacy APIs (i.e. SendUserTurn, SendUserMessage).")];
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
  }).describe("Request initiated from the server and sent to the client.")
