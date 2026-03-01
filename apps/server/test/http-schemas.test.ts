import { describe, expect, it } from "vitest";
import {
  parseBody,
  TraceMarkBodySchema,
  TraceStartBodySchema,
} from "../src/http-schemas.js";

describe("server request schemas", () => {
  it("validates trace start body", () => {
    const parsed = parseBody(TraceStartBodySchema, {
      label: "capture",
    });

    expect(parsed.label).toBe("capture");
  });

  it("rejects trace start unknown fields", () => {
    expect(() =>
      parseBody(TraceStartBodySchema, {
        label: "capture",
        extra: true,
      }),
    ).toThrowError(/Unrecognized key/);
  });

  it("validates trace mark body", () => {
    const parsed = parseBody(TraceMarkBodySchema, {
      note: "checkpoint",
    });

    expect(parsed.note).toBe("checkpoint");
  });

  it("rejects note over max length", () => {
    expect(() =>
      parseBody(TraceMarkBodySchema, {
        note: "x".repeat(501),
      }),
    ).toThrowError(/at most 500/);
  });
});
