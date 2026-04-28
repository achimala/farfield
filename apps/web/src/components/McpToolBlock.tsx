import { memo, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Code2,
  Keyboard,
  Loader2,
  MousePointer2,
  Search,
  Wrench,
  XCircle,
} from "lucide-react";
import { z } from "zod";
import type { UnifiedItem } from "@farfield/unified-surface";
import { Button } from "@/components/ui/button";
import { CodeSnippet } from "./CodeSnippet";

type McpToolItem = Extract<UnifiedItem, { type: "mcpToolCall" }>;

const NodeReplJsArgumentsSchema = z
  .object({
    title: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
    code: z.string(),
  })
  .passthrough();

const ComputerUseArgumentsSchema = z
  .object({
    app: z.string().optional(),
    element_index: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    value: z.string().optional(),
  })
  .passthrough();

const ToolSearchArgumentsSchema = z
  .object({
    query: z.string().optional(),
    limit: z.number().int().positive().optional(),
  })
  .passthrough();

const TextContentSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

const ImageContentSchema = z
  .object({
    type: z.literal("image"),
    mimeType: z.string().optional(),
  })
  .passthrough();

interface DetailRow {
  label: string;
  value: string;
  code?: boolean;
}

function formatToolTitle(item: McpToolItem): string {
  if (item.server === "node_repl" && item.tool === "js") {
    const parsed = NodeReplJsArgumentsSchema.safeParse(item.arguments);
    return parsed.success && parsed.data.title ? parsed.data.title : "Node REPL";
  }

  if (item.server === "computer-use") {
    switch (item.tool) {
      case "get_app_state":
        return "Inspect app";
      case "click":
        return "Click";
      case "type_text":
        return "Type text";
      case "press_key":
        return "Press key";
      case "set_value":
        return "Set value";
      case "list_apps":
        return "List apps";
      default:
        return item.tool;
    }
  }

  if (item.server === "tool_search") {
    return "Search tools";
  }

  return `${item.server}/${item.tool}`;
}

function iconForTool(item: McpToolItem): React.ElementType {
  if (item.server === "node_repl" && item.tool === "js") return Code2;
  if (item.server === "tool_search") return Search;
  if (item.server === "computer-use") {
    switch (item.tool) {
      case "click":
        return MousePointer2;
      case "type_text":
      case "press_key":
      case "set_value":
        return Keyboard;
      default:
        return Wrench;
    }
  }
  return Wrench;
}

function buildDetailRows(item: McpToolItem): DetailRow[] {
  if (item.server === "node_repl" && item.tool === "js") {
    const parsed = NodeReplJsArgumentsSchema.safeParse(item.arguments);
    if (!parsed.success) return [];

    return [
      { label: "tool", value: `${item.server}/${item.tool}`, code: true },
      ...(parsed.data.timeout_ms
        ? [{ label: "timeout", value: `${parsed.data.timeout_ms}ms` }]
        : []),
    ];
  }

  if (item.server === "computer-use") {
    const parsed = ComputerUseArgumentsSchema.safeParse(item.arguments);
    if (!parsed.success) return [];

    return [
      { label: "tool", value: `${item.server}/${item.tool}`, code: true },
      ...(parsed.data.app ? [{ label: "app", value: parsed.data.app, code: true }] : []),
      ...(parsed.data.element_index
        ? [{ label: "element", value: parsed.data.element_index, code: true }]
        : []),
      ...(parsed.data.key ? [{ label: "key", value: parsed.data.key, code: true }] : []),
      ...(parsed.data.value
        ? [{ label: "value", value: parsed.data.value, code: true }]
        : []),
      ...(parsed.data.text
        ? [{ label: "text", value: parsed.data.text, code: parsed.data.text.length < 64 }]
        : []),
    ];
  }

  if (item.server === "tool_search") {
    const parsed = ToolSearchArgumentsSchema.safeParse(item.arguments);
    if (!parsed.success) return [];

    return [
      { label: "tool", value: `${item.server}/${item.tool}`, code: true },
      ...(parsed.data.query ? [{ label: "query", value: parsed.data.query }] : []),
      ...(parsed.data.limit ? [{ label: "limit", value: String(parsed.data.limit) }] : []),
    ];
  }

  return [{ label: "tool", value: `${item.server}/${item.tool}`, code: true }];
}

function firstTextResult(item: McpToolItem): string | null {
  const firstContent = item.result?.content[0];
  const parsed = TextContentSchema.safeParse(firstContent);
  if (!parsed.success) return null;
  return parsed.data.text;
}

function imageResultCount(item: McpToolItem): number {
  return item.result?.content.filter((content) => ImageContentSchema.safeParse(content).success)
    .length ?? 0;
}

function resultPartCount(item: McpToolItem): number {
  return item.result?.content.length ?? 0;
}

function codeForNodeRepl(item: McpToolItem): string | null {
  const parsed = NodeReplJsArgumentsSchema.safeParse(item.arguments);
  if (!parsed.success) return null;
  return parsed.data.code;
}

function renderStatusIcon(item: McpToolItem): React.JSX.Element | null {
  if (item.status === "inProgress") {
    return <Loader2 size={12} className="animate-spin text-muted-foreground" />;
  }
  if (item.status === "completed") {
    return <CheckCircle2 size={12} className="text-success" />;
  }
  if (item.status === "failed") {
    return <XCircle size={12} className="text-danger" />;
  }
  return null;
}

function DetailRows({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 grid gap-1">
      {rows.map((row) => (
        <div
          key={`${row.label}:${row.value}`}
          className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 text-[11px] leading-5"
        >
          <div className="text-muted-foreground/60">{row.label}</div>
          <div className="min-w-0 text-foreground/80">
            {row.code ? (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                {row.value}
              </code>
            ) : (
              <span className="whitespace-pre-wrap break-words">{row.value}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function McpToolBlockComponent({
  item,
  className,
}: {
  item: McpToolItem;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(item.status === "inProgress");
  const lastStatusRef = useRef(item.status);

  useEffect(() => {
    if (item.status === "completed" && lastStatusRef.current === "inProgress") {
      setExpanded(false);
    }
    lastStatusRef.current = item.status;
  }, [item.status]);

  const ToolIcon = iconForTool(item);
  const title = formatToolTitle(item);
  const details = buildDetailRows(item);
  const nodeCode = codeForNodeRepl(item);
  const textResult = firstTextResult(item);
  const imageCount = imageResultCount(item);
  const contentCount = resultPartCount(item);

  return (
    <div className={`${className ?? ""} rounded-xl border border-border overflow-hidden text-sm`}>
      <Button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        variant="ghost"
        className="h-auto w-full grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-none bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70"
      >
        <div className="min-w-0 flex items-center gap-2">
          <ToolIcon size={13} className="shrink-0 text-muted-foreground/70" />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground/85">
              {title}
            </div>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {renderStatusIcon(item)}
          {item.durationMs != null && (
            <span className="text-[11px] font-mono text-muted-foreground/50">
              {item.durationMs}ms
            </span>
          )}
          <ChevronRight
            size={12}
            className={`text-muted-foreground/60 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </Button>

      {expanded && (details.length > 0 || nodeCode || item.error?.message || textResult) && (
        <div className="border-t border-border/60 px-3 py-2">
          <DetailRows rows={details} />

          {nodeCode && (
            <div className={details.length > 0 ? "mt-2" : ""}>
              <CodeSnippet code={nodeCode} language="javascript" />
            </div>
          )}

          {item.error?.message && (
            <div className="mt-2 text-xs text-danger whitespace-pre-wrap break-words">
              {item.error.message}
            </div>
          )}

          {textResult && (
            <div className={nodeCode || item.error?.message ? "mt-2" : ""}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Result
              </div>
              <CodeSnippet
                code={textResult}
                language="text"
                className="max-h-56 overflow-y-auto"
              />
            </div>
          )}

          {(contentCount > 1 || imageCount > 0) && (
            <div className="mt-2 text-[11px] text-muted-foreground/65">
              {contentCount} result part{contentCount === 1 ? "" : "s"}
              {imageCount > 0
                ? `, ${imageCount} image${imageCount === 1 ? "" : "s"}`
                : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const McpToolBlock = memo(McpToolBlockComponent);
