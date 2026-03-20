import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { UnifiedItem } from "@farfield/unified-surface";
import { ConversationItem } from "../src/components/ConversationItem.js";

function renderConversationItem(item: UnifiedItem) {
  return render(
    <ConversationItem
      item={item}
      isLast={false}
      turnIsInProgress={false}
      onSelectThread={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("ConversationItem", () => {
  it("renders user messages with both text and images", () => {
    renderConversationItem({
      id: "user-with-image",
      type: "userMessage",
      content: [
        { type: "text", text: "please inspect this screenshot" },
        { type: "image", url: "https://example.com/screenshot.png" },
      ],
    });

    expect(screen.getByText("please inspect this screenshot")).toBeTruthy();
    expect(screen.getByText("User image 1")).toBeTruthy();
    expect(screen.getByText("https://example.com/screenshot.png")).toBeTruthy();
  });

  it("renders image-only steering messages", () => {
    renderConversationItem({
      id: "steering-image-only",
      type: "steeringUserMessage",
      content: [
        { type: "image", url: "https://example.com/diagram.png" },
      ],
    });

    expect(screen.getByText("User image 1")).toBeTruthy();
    expect(screen.getByText("https://example.com/diagram.png")).toBeTruthy();
  });

  it("ignores empty user-message content", () => {
    const { container } = renderConversationItem({
      id: "user-empty-content",
      type: "userMessage",
      content: [
        { type: "text", text: "" },
        { type: "image", url: "   " },
      ],
    });

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("User image 1")).toBeNull();
  });
});
