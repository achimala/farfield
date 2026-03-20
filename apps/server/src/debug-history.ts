const MAX_HISTORY_STRING_LENGTH = 512;
const MAX_HISTORY_ARRAY_ITEMS = 24;
const MAX_HISTORY_OBJECT_KEYS = 24;
const MAX_HISTORY_TURN_PREVIEW_COUNT = 16;
const MAX_HISTORY_ITEM_PREVIEW_COUNT = 20;
const MAX_HISTORY_PATCH_PREVIEW_COUNT = 24;

export interface StoredHistoryPayload {
  json: string;
  originalBytes: number;
  storedBytes: number;
  compacted: boolean;
}

export function prepareHistoryPayloadForStorage(
  payload: unknown,
): StoredHistoryPayload {
  const originalJson = safeJsonStringify(payload);
  let compactedPayload: unknown;
  try {
    compactedPayload = compactHistoryPayload(payload);
  } catch {
    compactedPayload = payload;
  }
  const compactedJson = safeJsonStringify(compactedPayload);
  const originalBytes = Buffer.byteLength(originalJson, "utf8");
  const storedBytes = Buffer.byteLength(compactedJson, "utf8");

  return {
    json: compactedJson,
    originalBytes,
    storedBytes,
    compacted: compactedJson !== originalJson,
  };
}

function compactHistoryPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return compactJsonValue(payload, 0);
  }

  if (payload["method"] === "thread-stream-state-changed") {
    return compactThreadStreamStateChangedPayload(payload);
  }

  return compactJsonValue(payload, 0);
}

function compactThreadStreamStateChangedPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const params = asRecord(payload["params"]);
  const change = asRecord(params?.["change"]);

  if (!params || !change) {
    return compactJsonValue(payload, 0) as Record<string, unknown>;
  }

  if (change["type"] === "snapshot") {
    const conversationState = asRecord(change["conversationState"]);
    if (!conversationState) {
      return compactJsonValue(payload, 0) as Record<string, unknown>;
    }

    return {
      ...payload,
      params: {
        ...params,
        change: {
          ...change,
          conversationState: compactConversationState(conversationState),
        },
      },
    };
  }

  if (change["type"] === "patches") {
    const patches = Array.isArray(change["patches"]) ? change["patches"] : [];
    return {
      ...payload,
      params: {
        ...params,
        change: {
          ...change,
          patchCount: patches.length,
          patches: patches
            .slice(0, MAX_HISTORY_PATCH_PREVIEW_COUNT)
            .map((patch, index) => compactPatch(patch, index)),
          ...(patches.length > MAX_HISTORY_PATCH_PREVIEW_COUNT
            ? {
                truncatedPatchCount:
                  patches.length - MAX_HISTORY_PATCH_PREVIEW_COUNT,
              }
            : {}),
        },
      },
    };
  }

  return compactJsonValue(payload, 0) as Record<string, unknown>;
}

function compactConversationState(
  conversationState: Record<string, unknown>,
): Record<string, unknown> {
  const turns = Array.isArray(conversationState["turns"])
    ? conversationState["turns"]
    : [];
  const requests = Array.isArray(conversationState["requests"])
    ? conversationState["requests"]
    : [];
  const retainedTurns = turns.slice(
    Math.max(0, turns.length - MAX_HISTORY_TURN_PREVIEW_COUNT),
  );

  return {
    ...conversationState,
    turnCount: turns.length,
    requestCount: requests.length,
    turns: retainedTurns.map((turn, index) =>
      compactTurn(turn, retainedTurns.length - 1 - index),
    ),
    requests: compactArray(requests, 1),
    ...(turns.length > MAX_HISTORY_TURN_PREVIEW_COUNT
      ? {
          truncatedTurnCount:
            turns.length - MAX_HISTORY_TURN_PREVIEW_COUNT,
        }
      : {}),
  };
}

function compactTurn(turn: unknown, reverseIndex: number): unknown {
  if (!isRecord(turn)) {
    return compactJsonValue(turn, 0);
  }

  const items = Array.isArray(turn["items"]) ? turn["items"] : [];
  return {
    ...(typeof turn["turnId"] === "string" ? { turnId: turn["turnId"] } : {}),
    ...(typeof turn["status"] === "string" ? { status: turn["status"] } : {}),
    ...(turn["error"] !== undefined
      ? { error: compactJsonValue(turn["error"], 1) }
      : {}),
    itemCount: items.length,
    itemTypes: items.map((item) =>
      isRecord(item) && typeof item["type"] === "string"
        ? item["type"]
        : "<unknown>",
    ),
    items: items
      .slice(Math.max(0, items.length - MAX_HISTORY_ITEM_PREVIEW_COUNT))
      .map((item) => compactTurnItem(item)),
    ...(items.length > MAX_HISTORY_ITEM_PREVIEW_COUNT
      ? {
          truncatedItemCount:
            items.length - MAX_HISTORY_ITEM_PREVIEW_COUNT,
        }
      : {}),
    ...(turn["params"] !== undefined
      ? { params: compactJsonValue(turn["params"], 1) }
      : {}),
    ...(turn["turnStartedAtMs"] !== undefined
      ? { turnStartedAtMs: turn["turnStartedAtMs"] }
      : {}),
    ...(turn["finalAssistantStartedAtMs"] !== undefined
      ? { finalAssistantStartedAtMs: turn["finalAssistantStartedAtMs"] }
      : {}),
    turnOffsetFromLatest: reverseIndex,
  };
}

function compactTurnItem(item: unknown): unknown {
  if (!isRecord(item)) {
    return compactJsonValue(item, 0);
  }

  const base = {
    ...(typeof item["id"] === "string" ? { id: item["id"] } : {}),
    ...(typeof item["type"] === "string" ? { type: item["type"] } : {}),
  };

  switch (item["type"]) {
    case "userMessage":
    case "steeringUserMessage":
      return {
        ...base,
        ...(item["attachments"] !== undefined
          ? { attachments: compactJsonValue(item["attachments"], 1) }
          : {}),
        content: compactJsonValue(item["content"], 1),
      };
    case "agentMessage":
      return {
        ...base,
        ...(typeof item["phase"] === "string"
          ? { phase: item["phase"] }
          : {}),
        ...(typeof item["text"] === "string"
          ? { text: compactString(item["text"]) }
          : {}),
      };
    case "reasoning":
      return {
        ...base,
        ...(item["summary"] !== undefined
          ? { summary: compactJsonValue(item["summary"], 1) }
          : {}),
        ...(typeof item["text"] === "string"
          ? { text: compactString(item["text"]) }
          : {}),
      };
    case "error":
      return {
        ...base,
        ...(typeof item["message"] === "string"
          ? { message: compactString(item["message"]) }
          : {}),
        ...(item["errorInfo"] !== undefined
          ? { errorInfo: compactJsonValue(item["errorInfo"], 1) }
          : {}),
        ...(item["additionalDetails"] !== undefined
          ? {
              additionalDetails: compactJsonValue(
                item["additionalDetails"],
                1,
              ),
            }
          : {}),
      };
    default:
      return compactJsonValue(item, 1);
  }
}

function compactPatch(patch: unknown, index: number): unknown {
  if (!isRecord(patch)) {
    return compactJsonValue(patch, 0);
  }

  return {
    index,
    ...(typeof patch["op"] === "string" ? { op: patch["op"] } : {}),
    ...(patch["path"] !== undefined
      ? { path: compactJsonValue(patch["path"], 1) }
      : {}),
    ...(patch["value"] !== undefined
      ? { value: compactJsonValue(patch["value"], 1) }
      : {}),
    ...(patch["from"] !== undefined
      ? { from: compactJsonValue(patch["from"], 1) }
      : {}),
  };
}

function compactJsonValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return compactString(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return compactArray(value, depth + 1);
  }

  if (!isRecord(value)) {
    return value;
  }

  const entries = Object.entries(value);
  const limitedEntries = entries.slice(0, MAX_HISTORY_OBJECT_KEYS);
  const result: Record<string, unknown> = {};

  for (const [key, nestedValue] of limitedEntries) {
    result[key] = compactJsonValue(nestedValue, depth + 1);
  }

  if (entries.length > MAX_HISTORY_OBJECT_KEYS) {
    result["__truncatedKeyCount"] =
      entries.length - MAX_HISTORY_OBJECT_KEYS;
  }

  if (depth >= 6) {
    result["__truncatedDepth"] = true;
  }

  return result;
}

function compactArray(values: unknown[], depth: number): unknown[] {
  const limitedValues = values.slice(0, MAX_HISTORY_ARRAY_ITEMS);
  const result = limitedValues.map((value) => compactJsonValue(value, depth + 1));

  if (values.length > MAX_HISTORY_ARRAY_ITEMS) {
    result.push({
      __truncatedArrayItems: values.length - MAX_HISTORY_ARRAY_ITEMS,
    });
  }

  return result;
}

function compactString(value: string): string {
  if (value.length <= MAX_HISTORY_STRING_LENGTH) {
    return value;
  }

  const truncatedLength = value.length - MAX_HISTORY_STRING_LENGTH;
  return `${value.slice(0, MAX_HISTORY_STRING_LENGTH)}... [${truncatedLength} chars truncated]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function safeJsonStringify(value: unknown): string {
  const rootValue = normalizeJsonRootValue(value);
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(
    rootValue,
    (_key, nestedValue) => {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    },
    2,
  );
  return serialized ?? "null";
}

function normalizeJsonRootValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return String(value);
  }
  return value;
}
