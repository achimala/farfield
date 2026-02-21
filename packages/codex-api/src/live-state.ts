import {
  type ThreadConversationState,
  parseThreadConversationState,
  type ThreadStreamPatch,
  type ThreadStreamStateChangedBroadcast
} from "@farfield/protocol";

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function patchPathSegmentLabel(segment: number | string): string {
  return typeof segment === "number" ? `[${segment}]` : segment;
}

function assertPathExists(target: unknown, path: (number | string)[]): void {
  let cursor = target;
  for (const segment of path) {
    if (Array.isArray(cursor) && typeof segment === "number") {
      if (segment < 0 || segment >= cursor.length) {
        throw new Error(`Patch path segment out of range: ${patchPathSegmentLabel(segment)}`);
      }
      cursor = cursor[segment];
      continue;
    }

    if (
      cursor &&
      typeof cursor === "object" &&
      !Array.isArray(cursor) &&
      typeof segment === "string"
    ) {
      if (!(segment in cursor)) {
        throw new Error(`Patch path segment missing: ${patchPathSegmentLabel(segment)}`);
      }
      cursor = (cursor as Record<string, unknown>)[segment];
      continue;
    }

    throw new Error(`Patch path invalid at segment ${patchPathSegmentLabel(segment)}`);
  }
}

export function applyStrictPatch(
  source: ThreadConversationState,
  patch: ThreadStreamPatch
): ThreadConversationState {
  const state = cloneState(source);

  if (patch.path.length === 0) {
    throw new Error("Patch path cannot be empty");
  }

  const parentPath = patch.path.slice(0, -1);
  const last = patch.path[patch.path.length - 1];

  assertPathExists(state, parentPath);

  let parent: unknown = state;
  for (const segment of parentPath) {
    if (typeof segment === "number") {
      if (!Array.isArray(parent)) {
        throw new Error(`Patch path invalid at segment ${patchPathSegmentLabel(segment)}`);
      }
      parent = parent[segment];
      continue;
    }

    parent = (parent as Record<string, unknown>)[segment];
  }

  if (Array.isArray(parent) && typeof last === "number") {
    if (patch.op === "add") {
      parent.splice(last, 0, patch.value);
      return parseThreadConversationState(state);
    }

    if (patch.op === "replace") {
      if (last < 0 || last >= parent.length) {
        throw new Error(`Patch replace index out of range: ${String(last)}`);
      }
      parent[last] = patch.value;
      return parseThreadConversationState(state);
    }

    if (patch.op === "remove") {
      if (last < 0 || last >= parent.length) {
        throw new Error(`Patch remove index out of range: ${String(last)}`);
      }
      parent.splice(last, 1);
      return parseThreadConversationState(state);
    }
  }

  if (
    parent &&
    typeof parent === "object" &&
    !Array.isArray(parent) &&
    typeof last === "string"
  ) {
    if (patch.op === "remove") {
      if (!(last in parent)) {
        throw new Error(`Patch remove key missing: ${last}`);
      }
      delete (parent as Record<string, unknown>)[last];
      return parseThreadConversationState(state);
    }

    (parent as Record<string, unknown>)[last] = patch.value;
    return parseThreadConversationState(state);
  }

  throw new Error("Patch target type mismatch");
}

export interface ThreadStreamDerivedState {
  ownerClientId: string | null;
  conversationState: ThreadConversationState | null;
}

export interface ThreadStreamReductionErrorDetails {
  threadId: string;
  eventIndex: number;
  patchIndex: number;
  event: ThreadStreamStateChangedBroadcast;
  patch: ThreadStreamPatch;
}

export class ThreadStreamReductionError extends Error {
  public readonly details: ThreadStreamReductionErrorDetails;

  public constructor(
    message: string,
    details: ThreadStreamReductionErrorDetails,
    cause?: unknown
  ) {
    super(message);
    this.name = "ThreadStreamReductionError";
    this.details = details;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function reduceThreadStreamEvents(
  events: ThreadStreamStateChangedBroadcast[]
): Map<string, ThreadStreamDerivedState> {
  const byThread = new Map<string, ThreadStreamDerivedState>();

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex] as ThreadStreamStateChangedBroadcast;
    const threadId = event.params.conversationId;
    const previous = byThread.get(threadId) ?? {
      ownerClientId: null,
      conversationState: null
    };

    const next: ThreadStreamDerivedState = {
      ownerClientId: event.sourceClientId,
      conversationState: previous.conversationState
    };

    const change = event.params.change;

    if (change.type === "snapshot") {
      next.conversationState = change.conversationState;
      byThread.set(threadId, next);
      continue;
    }

    if (!next.conversationState) {
      // The desktop app can emit patches before the first snapshot for a thread.
      // Ignore these until we have a concrete base state.
      byThread.set(threadId, next);
      continue;
    }

    let updated = next.conversationState;
    for (let patchIndex = 0; patchIndex < change.patches.length; patchIndex += 1) {
      const patch = change.patches[patchIndex] as ThreadStreamPatch;
      try {
        updated = applyStrictPatch(updated, patch);
      } catch (error) {
        throw new ThreadStreamReductionError(
          `Thread stream reduction failed for thread ${threadId} at event ${eventIndex}, patch ${patchIndex}: ${toErrorMessage(
            error
          )}`,
          {
            threadId,
            eventIndex,
            patchIndex,
            event,
            patch
          },
          error
        );
      }
    }

    next.conversationState = updated;
    byThread.set(threadId, next);
  }

  return byThread;
}

export function findLatestTurnParamsTemplate(
  conversationState: ThreadConversationState
): NonNullable<ThreadConversationState["turns"][number]["params"]> {
  for (let i = conversationState.turns.length - 1; i >= 0; i -= 1) {
    const turn = conversationState.turns[i];
    if (turn?.params) {
      return turn.params;
    }
  }

  throw new Error("No turn params template found in conversation state");
}
