import { describe, expect, it } from "vitest";
import { resolveOwnerClientId } from "../src/thread-owner.js";

describe("resolveOwnerClientId", () => {
  it("uses mapped owner when both mapped owner and override are present", () => {
    const owners = new Map<string, string>();
    owners.set("thread-1", "client-map");

    const owner = resolveOwnerClientId(owners, "thread-1", "client-override");
    expect(owner).toBe("client-map");
  });

  it("uses explicit override when mapped owner is missing", () => {
    const owner = resolveOwnerClientId(new Map(), "thread-1", "client-override");
    expect(owner).toBe("client-override");
  });

  it("uses mapped owner when override missing", () => {
    const owners = new Map<string, string>();
    owners.set("thread-1", "client-map");

    const owner = resolveOwnerClientId(owners, "thread-1");
    expect(owner).toBe("client-map");
  });

  it("uses fallback owner when mapped owner and override are missing", () => {
    const owner = resolveOwnerClientId(new Map(), "thread-1", undefined, "client-fallback");
    expect(owner).toBe("client-fallback");
  });

  it("throws when owner is unavailable", () => {
    expect(() => resolveOwnerClientId(new Map(), "thread-1")).toThrowError(
      /No owner client id/
    );
  });
});
