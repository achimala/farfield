import { memo } from "react";
import type { UnifiedItem, UnifiedItemKind } from "@farfield/unified-surface";
import { ReasoningBlock } from "./ReasoningBlock";
import { CommandBlock } from "./CommandBlock";
import { DiffBlock } from "./DiffBlock";
import { MarkdownText } from "./MarkdownText";

type UserMessageLikeItem = Extract<
  UnifiedItem,
  { type: "userMessage" | "steeringUserMessage" }
>;

interface Props {
  item: UnifiedItem;
  isLast: boolean;
  turnIsInProgress: boolean;
  previousItemType?: UnifiedItem["type"] | undefined;
  nextItemType?: UnifiedItem["type"] | undefined;
}

const TOOL_BLOCK_TYPES: readonly UnifiedItem["type"][] = [
  "commandExecution",
  "fileChange",
  "webSearch",
  "mcpToolCall",
  "collabAgentToolCall",
];

function isToolBlockType(type: UnifiedItem["type"] | undefined): boolean {
  return type !== undefined && TOOL_BLOCK_TYPES.includes(type);
}

function toolBlockSpacingClass(
  previousItemType: UnifiedItem["type"] | undefined,
  nextItemType: UnifiedItem["type"] | undefined,
): string {
  const previousIsTool = isToolBlockType(previousItemType);
  const nextIsTool = isToolBlockType(nextItemType);
  if (previousIsTool && nextIsTool) return "my-1";
  if (previousIsTool) return "mt-1 mb-2";
  if (nextIsTool) return "mt-2 mb-1";
  return "my-2";
}

function readTextContent(content: UserMessageLikeItem["content"]): string {
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

interface RendererContext {
  isActive: boolean;
  toolSpacing: string;
}

type ItemRendererMap = {
  [K in UnifiedItemKind]: (
    args: RendererContext & { item: Extract<UnifiedItem, { type: K }> },
  ) => React.JSX.Element | null;
};

const ITEM_RENDERERS = {
  userMessage: ({ item }) => {
    const text = readTextContent(item.content);
    if (!text) {
      return null;
    }

    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground leading-relaxed">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    );
  },

  steeringUserMessage: ({ item }) => {
    const text = readTextContent(item.content);
    if (!text) {
      return null;
    }

    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground leading-relaxed">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    );
  },

  agentMessage: ({ item }) => {
    if (!item.text) {
      return null;
    }

    return <MarkdownText text={item.text} />;
  },

  error: ({ item }) => (
    <div className="my-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-red-300 mb-2">
        Error
      </div>
      <div className="text-sm text-red-100 whitespace-pre-wrap break-words leading-relaxed">
        {item.message}
      </div>
    </div>
  ),

  reasoning: ({ item, isActive }) => {
    const summary = item.summary ?? [];
    if (summary.length === 0 && !item.text) {
      return null;
    }

    return (
      <ReasoningBlock
        summary={summary.length > 0 ? summary : ["Thinking…"]}
        text={item.text}
        isActive={isActive}
      />
    );
  },

  plan: ({ item }) => (
    <div className="my-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Plan
      </div>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
        {item.text}
      </div>
    </div>
  ),

  todoList: ({ item }) => (
    <div className="my-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Checklist
      </div>
      {item.explanation && (
        <div className="mb-2 text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {item.explanation}
        </div>
      )}
      <ul className="space-y-1">
        {item.plan.map((entry, index) => (
          <li
            key={`${entry.step}-${String(index)}`}
            className="text-sm text-foreground/90 flex items-start gap-2"
          >
            <span className="mt-[2px] text-muted-foreground">
              {entry.status === "completed" ? "x" : "o"}
            </span>
            <span className="whitespace-pre-wrap break-words">
              {entry.step}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ),

  planImplementation: ({ item }) => (
    <div className="my-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Plan Implementation
      </div>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
        {item.planContent}
      </div>
    </div>
  ),

  userInputResponse: ({ item }) => {
    const answersText = Object.values(item.answers)
      .map((answers) => answers.join(", "))
      .join("\n");

    if (!answersText) {
      return null;
    }

    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl border border-border bg-muted/30 px-4 py-2.5">
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider font-medium">
            Response
          </div>
          <div className="text-sm text-foreground whitespace-pre-wrap">
            {answersText}
          </div>
        </div>
      </div>
    );
  },

  commandExecution: ({ item, isActive, toolSpacing }) => (
    <div className={toolSpacing}>
      <CommandBlock item={item} isActive={isActive} />
    </div>
  ),

  fileChange: ({ item, toolSpacing }) => (
    <div className={toolSpacing}>
      <DiffBlock changes={item.changes} />
    </div>
  ),

  contextCompaction: (_args) => (
    <div className="flex items-center my-6">
      <div className="flex-1 border-t border-dashed border-border/80"></div>
      <div className="mx-4 text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium">
        Compacted
      </div>
      <div className="flex-1 border-t border-dashed border-border/80"></div>
    </div>
  ),

  webSearch: ({ item, toolSpacing }) => (
    <div
      className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}
    >
      <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
        Web search
      </div>
      <div className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
        {item.query}
      </div>
    </div>
  ),

  mcpToolCall: ({ item, toolSpacing }) => {
    const argumentsText = JSON.stringify(item.arguments);
    return (
      <div
        className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}
      >
        <div className="text-[10px] text-muted-foreground font-mono mb-1 uppercase tracking-wider">
          MCP tool
        </div>
        <div className="text-xs text-foreground/90 whitespace-pre-wrap break-words">
          {item.server}/{item.tool} ({item.status})
        </div>
        {item.durationMs != null && (
          <div className="mt-1 text-[11px] text-muted-foreground font-mono">
            {item.durationMs}ms
          </div>
        )}
        {item.error?.message && (
          <div className="mt-2 text-xs text-danger whitespace-pre-wrap break-words">
            {item.error.message}
          </div>
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
  },

  collabAgentToolCall: ({ item, toolSpacing }) => (
    <div
      className={`${toolSpacing} rounded-lg border border-border bg-muted/20 px-3 py-2`}
    >
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
  ),

  imageView: ({ item }) => (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      Viewed image: {item.path}
    </div>
  ),

  enteredReviewMode: ({ item }) => (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      Entered review mode: {item.review}
    </div>
  ),

  exitedReviewMode: ({ item }) => (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      Exited review mode: {item.review}
    </div>
  ),

  modelChanged: (_args) => (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      Model changed
    </div>
  ),
} satisfies ItemRendererMap;

function assertNever(value: never): never {
  throw new Error(`Unhandled item kind: ${String(value)}`);
}

function renderItem(
  item: UnifiedItem,
  context: RendererContext,
): React.JSX.Element | null {
  switch (item.type) {
    case "userMessage":
      return ITEM_RENDERERS.userMessage({ item, ...context });
    case "steeringUserMessage":
      return ITEM_RENDERERS.steeringUserMessage({ item, ...context });
    case "agentMessage":
      return ITEM_RENDERERS.agentMessage({ item, ...context });
    case "error":
      return ITEM_RENDERERS.error({ item, ...context });
    case "reasoning":
      return ITEM_RENDERERS.reasoning({ item, ...context });
    case "plan":
      return ITEM_RENDERERS.plan({ item, ...context });
    case "todoList":
      return ITEM_RENDERERS.todoList({ item, ...context });
    case "planImplementation":
      return ITEM_RENDERERS.planImplementation({ item, ...context });
    case "userInputResponse":
      return ITEM_RENDERERS.userInputResponse({ item, ...context });
    case "commandExecution":
      return ITEM_RENDERERS.commandExecution({ item, ...context });
    case "fileChange":
      return ITEM_RENDERERS.fileChange({ item, ...context });
    case "contextCompaction":
      return ITEM_RENDERERS.contextCompaction({ item, ...context });
    case "webSearch":
      return ITEM_RENDERERS.webSearch({ item, ...context });
    case "mcpToolCall":
      return ITEM_RENDERERS.mcpToolCall({ item, ...context });
    case "collabAgentToolCall":
      return ITEM_RENDERERS.collabAgentToolCall({ item, ...context });
    case "imageView":
      return ITEM_RENDERERS.imageView({ item, ...context });
    case "enteredReviewMode":
      return ITEM_RENDERERS.enteredReviewMode({ item, ...context });
    case "exitedReviewMode":
      return ITEM_RENDERERS.exitedReviewMode({ item, ...context });
    case "modelChanged":
      return ITEM_RENDERERS.modelChanged({ item, ...context });
    default:
      return assertNever(item);
  }
}

function ConversationItemComponent({
  item,
  isLast,
  turnIsInProgress,
  previousItemType,
  nextItemType,
}: Props) {
  const isActive = isLast && turnIsInProgress;
  const toolSpacing = toolBlockSpacingClass(previousItemType, nextItemType);

  return renderItem(item, {
    isActive,
    toolSpacing,
  });
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

export const ConversationItem = memo(
  ConversationItemComponent,
  areConversationItemPropsEqual,
);
