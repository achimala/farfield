import type { z } from "zod";
import type { TurnItemSchema } from "@codex-monitor/codex-protocol";
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
}

function readTextContent(content: UserMessageLikeItem["content"]): string {
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

export function ConversationItem({ item, isLast, turnIsInProgress }: Props) {
  const isActive = isLast && turnIsInProgress;

  /* ── User message ───────────────────────────────────── */
  if (item.type === "userMessage" || item.type === "steeringUserMessage") {
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
  if (item.type === "agentMessage") {
    if (!item.text) return null;
    return (
      <MarkdownText text={item.text} />
    );
  }

  /* ── Reasoning ──────────────────────────────────────── */
  if (item.type === "reasoning") {
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
  if (item.type === "plan") {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Plan
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {item.text}
        </div>
      </div>
    );
  }

  /* ── User input response ────────────────────────────── */
  if (item.type === "userInputResponse") {
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
  if (item.type === "commandExecution") {
    return <CommandBlock item={item} isActive={isActive} />;
  }

  /* ── File change ────────────────────────────────────── */
  if (item.type === "fileChange") {
    return (
      <DiffBlock changes={item.changes} />
    );
  }

  /* ── Context compaction ─────────────────────────────── */
  if (item.type === "contextCompaction") {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Context compacted
      </div>
    );
  }

  /* ── Web search ─────────────────────────────────────── */
  if (item.type === "webSearch") {
    return (
      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
        <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
          Web search
        </div>
        <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {item.query}
        </div>
      </div>
    );
  }

  return null;
}
