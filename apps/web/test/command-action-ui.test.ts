import { describe, expect, it } from "vitest";
import {
  describeCommandAction,
  summarizeCommandForHeader,
} from "../src/lib/command-action-ui";

describe("describeCommandAction", () => {
  it("describes a direct sed range read", () => {
    const presentation = describeCommandAction({
      type: "unknown",
      command: "sed -n '12,34p' apps/web/src/components/CommandBlock.tsx",
    });

    expect(presentation.iconKey).toBe("read");
    expect(presentation.text).toBe("Read lines 12-34 from CommandBlock.tsx");
    expect(presentation.tooltip).toBe(
      "Read lines 12-34 from apps/web/src/components/CommandBlock.tsx",
    );
    expect(presentation.rawCommand).toBe(
      "sed -n '12,34p' apps/web/src/components/CommandBlock.tsx",
    );
  });

  it("describes an nl plus sed range read", () => {
    const presentation = describeCommandAction({
      type: "read",
      command: "nl -ba apps/web/src/components/DiffBlock.tsx | sed -n '80,120p'",
    });

    expect(presentation.iconKey).toBe("read");
    expect(presentation.text).toBe("Read lines 80-120 from DiffBlock.tsx");
    expect(presentation.tooltip).toBe(
      "Read lines 80-120 from apps/web/src/components/DiffBlock.tsx",
    );
  });

  it("describes ripgrep search commands", () => {
    const presentation = describeCommandAction({
      type: "search",
      command:
        "rg -n \"commandActions\" apps/web/src/components/CommandBlock.tsx",
    });

    expect(presentation.iconKey).toBe("search");
    expect(presentation.text).toBe("Searched \"commandActions\" in CommandBlock.tsx");
    expect(presentation.tooltip).toBe(
      "Searched \"commandActions\" in apps/web/src/components/CommandBlock.tsx",
    );
  });

  it("uses explicit action fields when available", () => {
    const presentation = describeCommandAction({
      type: "search",
      query: "DiffBlock",
      path: "apps/web/src/components",
      command:
        "rg -n --glob '*.tsx' \"DiffBlock\" apps/web/src/components",
    });

    expect(presentation.text).toBe("Searched \"DiffBlock\" in components");
    expect(presentation.tooltip).toBe("Searched \"DiffBlock\" in apps/web/src/components");
  });

  it("summarizes combined shell commands as multiple header segments", () => {
    const segments = summarizeCommandForHeader(
      "/bin/zsh -lc 'pwd && rg -n \"commandActions\" apps/web/src/components/CommandBlock.tsx'",
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]?.text).toBe("pwd");
    expect(segments[1]?.text).toBe(
      "Searched \"commandActions\" in CommandBlock.tsx",
    );
    expect(segments[1]?.tooltip).toBe(
      "Searched \"commandActions\" in apps/web/src/components/CommandBlock.tsx",
    );
  });

  it("prefers action summaries when only one command segment exists", () => {
    const segments = summarizeCommandForHeader(
      "/bin/zsh -lc 'nl -ba apps/web/src/components/DiffBlock.tsx | sed -n \"80,120p\"'",
      [
        {
          type: "read",
          command:
            "nl -ba apps/web/src/components/DiffBlock.tsx | sed -n '80,120p'",
        },
      ],
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe("Read lines 80-120 from DiffBlock.tsx");
    expect(segments[0]?.tooltip).toBe(
      "Read lines 80-120 from apps/web/src/components/DiffBlock.tsx",
    );
  });
});
