import { describe, expect, it } from "vitest";
import { languageFromPath } from "../src/lib/code-language";

describe("languageFromPath", () => {
  it("detects common extensions", () => {
    expect(languageFromPath("src/index.ts")).toBe("typescript");
    expect(languageFromPath("src/view.tsx")).toBe("tsx");
    expect(languageFromPath("src/styles.css")).toBe("css");
    expect(languageFromPath("docs/README.md")).toBe("markdown");
  });

  it("handles dockerfiles and missing extensions", () => {
    expect(languageFromPath("Dockerfile")).toBe("docker");
    expect(languageFromPath("src/Makefile")).toBe("text");
    expect(languageFromPath("")).toBe("text");
  });
});
