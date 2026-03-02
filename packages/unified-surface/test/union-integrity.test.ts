import { describe, expect, it } from "vitest";
import {
  UNIFIED_COMMAND_KINDS,
  UNIFIED_REALTIME_CLIENT_MESSAGE_KINDS,
  UNIFIED_REALTIME_SERVER_MESSAGE_KINDS,
  UNIFIED_EVENT_KINDS,
  UNIFIED_FEATURE_IDS,
  UNIFIED_ITEM_KINDS,
  UnifiedCommandSchema,
  UnifiedCommandResultSchema,
  UnifiedEventSchema,
  UnifiedFeatureMatrixSchema,
  UnifiedItemSchema,
  UnifiedRealtimeClientMessageSchema,
  UnifiedRealtimeServerMessageSchema
} from "../src/index.js";

describe("unified surface unions", () => {
  it("has command and result variants in sync", () => {
    expect(UNIFIED_COMMAND_KINDS.length).toBeGreaterThan(0);
    for (const kind of UNIFIED_COMMAND_KINDS) {
      expect(
        UnifiedCommandSchema.options.some((schema) => schema.shape.kind.value === kind)
      ).toBe(true);
      expect(
        UnifiedCommandResultSchema.options.some((schema) => schema.shape.kind.value === kind)
      ).toBe(true);
    }
  });

  it("has an exhaustive item kind list", () => {
    expect(UNIFIED_ITEM_KINDS.length).toBe(UnifiedItemSchema.options.length);
  });

  it("has an exhaustive event kind list", () => {
    expect(UNIFIED_EVENT_KINDS.length).toBe(UnifiedEventSchema.options.length);
  });

  it("has an exhaustive realtime server message kind list", () => {
    expect(UNIFIED_REALTIME_SERVER_MESSAGE_KINDS.length).toBe(
      UnifiedRealtimeServerMessageSchema.options.length
    );
  });

  it("has an exhaustive realtime client message kind list", () => {
    expect(UNIFIED_REALTIME_CLIENT_MESSAGE_KINDS.length).toBe(
      UnifiedRealtimeClientMessageSchema.options.length
    );
  });

  it("strictly validates realtime client messages", () => {
    const valid = UnifiedRealtimeClientMessageSchema.parse({
      kind: "hello",
      selectedThreadId: null,
      activeTab: "chat"
    });
    expect(valid.kind).toBe("hello");

    expect(() =>
      UnifiedRealtimeClientMessageSchema.parse({
        kind: "hello",
        selectedThreadId: null,
        activeTab: "chat",
        extra: true
      })
    ).toThrowError(/Unrecognized key/);
  });

  it("strictly validates realtime server messages", () => {
    const valid = UnifiedRealtimeServerMessageSchema.parse({
      kind: "syncError",
      syncVersion: 1,
      message: "sync failed",
      code: "syncError"
    });
    expect(valid.kind).toBe("syncError");

    expect(() =>
      UnifiedRealtimeServerMessageSchema.parse({
        kind: "syncError",
        syncVersion: 1,
        message: "sync failed",
        code: "syncError",
        extra: true
      })
    ).toThrowError(/Unrecognized key/);
  });

  it("validates feature matrix shape", () => {
    const parsed = UnifiedFeatureMatrixSchema.parse({
      codex: {},
      opencode: {}
    });

    expect(parsed.codex).toEqual({});
    expect(parsed.opencode).toEqual({});
    expect(UNIFIED_FEATURE_IDS.length).toBeGreaterThan(0);
  });
});
