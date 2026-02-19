import { memo } from "react";
import type { z } from "zod";
import type { TurnItemSchema } from "@farfield/protocol";
import { ReasoningBlock } from "./ReasoningBlock";
import { CommandBlock } from "./CommandBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownText } from "./MarkdownText";

type TurnItem = z.infer<typeof TurnItemSchema>;
type UserMessageLikeItem = Extract<TurnItem, { type: "userMessage" | "steeringUserMessage" }>;

interface Props {
  item: TurnItem;
  isLast: boolean;
  turnIsInProgress: boolean;
  previousItemType?: TurnItem["type"] | undefined;
  nextItemType?: TurnItem["type"] | undefined;
}

const TOOL_BLOCK_TYPES: readonly TurnItem["type"][] = [
  "commandExecution",
  "fileChange",
  "webSearch",
  "mcpToolCall",
  "collabAgentToolCall"
];

function isToolBlockType(type: TurnItem["type"] | undefined): boolean {
  return type !== undefined && TOOL_BLOCK_TYPES.includes(type);
}

function toolBlockSpacingClass(
  previousItemType: TurnItem["type"] | undefined,
  nextItemType: TurnItem["type"] | undefined
): string {
  const previousIsTool = isToolBlockType(previousItemType);
  const nextIsTool = isToolBlockType(nextItemType);
  if (previousIsTool && nextIsTool) return "my-1";
  if (previousIsTool) return "mt-1 mb-4";
  if (nextIsTool) return "mt-4 mb-1";
  return "my-4";
}

function readTextContent(content: UserMessageLikeItem["content"]): string {
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled turn item type: ${String(value)}`);
}

function ConversationItemComponent({
  item,
  isLast,
  turnIsInProgress,
  previousItemType,
  nextItemType
}: Props) {
  const isActive = isLast && turnIsInProgress;
  const toolSpacing = toolBlockSpacingClass(previousItemType, nextItemType);

  switch (item.type) {
    /* ── User message ───────────────────────────────────── */
    case "userMessage":
    case "steeringUserMessage": {
      const text = readTextContent(item.content);
      if (!text) return null;
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground leading-relaxed">
            <p className="whitespace-pre-wrap break-words">{text}</p>
          </div>
        </div>
      );
    }

    /* ── Agent message ──────────────────────────────────── */
    case "agentMessage":
      if (!item.text) return null;
      return (
        <MarkdownText text={item.text} />
      );

    /* ── Error message ──────────────────────────────────── */
    case "error":
      return (
        <div className="my-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-red-300 mb-2">
            Error
          </div>
          <div className="text-sm text-red-100 whitespace-pre-wrap break-words leading-relaxed">
            {item.message}
          </div>
        </div>
      );

    /* ── Reasoning ──────────────────────────────────────── */
    case "reasoning": {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((s): s is string => typeof s === "string")
        : [];
      if (summary.length === 0 && !item.text) return null;
      return (
        <ReasoningBlock
          summary={summary.length > 0 ? summary : ["Thinking…"]}
          text={item.text}
          isActive={isActive}
        />
      );
    }

    /* ── Plan ───────────────────────────────────────────── */
    case "plan":
      return (
        <div className="my-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Plan
          </div>
          <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {item.text}
          </div>
        </div>
      );

    /* ── Plan implementation ────────────────────────────── */
    case "planImplementation":
      return (
        <div className="my-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Plan Implementation
          </div>
          <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {item.planContent}
          </div>
        </div>
      );

    /* ── User input response ────────────────────────────── */
    case "userInputResponse": {
      const answersText = Object.entries(item.answers)
        .map(([_id, vals]) => vals.join(", "))
        .join("\n");
      if (!answersText) return null;
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl border border-border bg-muted/30 px-4 py-2.5">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
              Response
            </div>
            <div className="text-sm text-foreground whitespace-pre-wrap">{answersText}</div>
          </div>
        </div>
      );
    }

    /* ── Command execution ──────────────────────────────── */
    case "commandExecution":
      return (
        <div className={toolSpacing}>
          <CommandBlock item={item} isActive={isActive} />
        </div>
      );

    /* ── File change ────────────────────────────────────── */
    case "fileChange":
      return (
        <div className={toolSpacing}>
          <DiffBlock changes={item.changes} />
        </div>
      );

    /* ── Context compaction ─────────────────────────────── */
    case "contextCompaction":
      return (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Context compacted
        </div>
      );

    /* ── Web search ─────────────────────────────────────── */
    case "webSearch":
      return (
        <div className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}>
          <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
            Web search
          </div>
          <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
            {item.query}
          </div>
        </div>
      );

    case "mcpToolCall": {
      const argumentsText = JSON.stringify(item.arguments);
      return (
        <div className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}>
          <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
            MCP tool
          </div>
          <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words">
            {item.server}/{item.tool} ({item.status})
          </div>
          {item.durationMs != null && (
            <div className="mt-1 text-[11px] text-muted-foreground font-mono">{item.durationMs}ms</div>
          )}
          {item.error?.message && (
            <div className="mt-2 text-xs text-danger whitespace-pre-wrap break-words">{item.error.message}</div>
          )}
          {item.result?.content && item.result.content.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Result parts: {item.result.content.length}
            </div>
          )}
          <div className="mt-2 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all">
            {argumentsText}
          </div>
        </div>
      );
    }

    case "collabAgentToolCall":
      return (
        <div className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}>
          <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
            Collab tool
          </div>
          <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words">
            {item.tool} ({item.status})
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
            sender: {item.senderThreadId}
          </div>
          <div className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
            receivers: {item.receiverThreadIds.join(", ") || "none"}
          </div>
          {item.prompt && (
            <div className="mt-2 text-xs text-foreground/80 whitespace-pre-wrap break-words">
              {item.prompt}
            </div>
          )}
        </div>
      );

    case "imageView":
      return (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Viewed image: {item.path}
        </div>
      );

    case "enteredReviewMode":
      return (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Entered review mode: {item.review}
        </div>
      );

    case "exitedReviewMode":
      return (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Exited review mode: {item.review}
        </div>
      );

    case "modelChanged":
      return (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          Model changed
        </div>
      );

    default:
      return assertNever(item);
  }
}

function areConversationItemPropsEqual(prev: Props, next: Props): boolean {
  return (
    prev.item === next.item &&
    prev.isLast === next.isLast &&
    prev.turnIsInProgress === next.turnIsInProgress &&
    prev.previousItemType === next.previousItemType &&
    prev.nextItemType === next.nextItemType
  );
}

export const ConversationItem = memo(ConversationItemComponent, areConversationItemPropsEqual);
