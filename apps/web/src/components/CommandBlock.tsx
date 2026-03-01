import React, { memo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Search,
  FolderOpen,
  FileText,
  FileSearch,
} from "lucide-react";
import type { UnifiedItem } from "@farfield/unified-surface";
import { Button } from "@/components/ui/button";
import { summarizeCommandForHeader } from "@/lib/command-action-ui";
import { CodeSnippet } from "./CodeSnippet";

type CommandItem = Extract<UnifiedItem, { type: "commandExecution" }>;

const ACTION_ICONS: Record<string, React.ElementType> = {
  search: Search,
  listFiles: FolderOpen,
  write: FileText,
  read: FileSearch,
  readFile: FileSearch,
  writeFile: FileText,
};

interface CommandBlockProps {
  item: CommandItem;
  isActive: boolean;
}

function CommandBlockComponent({ item, isActive }: CommandBlockProps) {
  const [expanded, setExpanded] = useState(item.status === "inProgress");
  const lastStatusRef = React.useRef(item.status);

  React.useEffect(() => {
    if (item.status === "completed" && lastStatusRef.current === "inProgress") {
      setExpanded(false);
    }
    lastStatusRef.current = item.status;
  }, [item.status]);
  const isCompleted = item.status === "completed";
  const isSuccess = item.exitCode === 0 || item.exitCode == null;
  const output =
    typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
  const hasOutput = output.trim().length > 0;
  const headerSegments = summarizeCommandForHeader(item.command, item.commandActions);
  const displayedHeaderSegments = headerSegments.slice(0, 3);
  const hiddenHeaderSegmentsCount = Math.max(headerSegments.length - 3, 0);

  return (
    <div className="rounded-xl border border-border overflow-hidden text-sm">
      {/* Header row */}
      <Button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        variant="ghost"
        className="h-auto w-full grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-none bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70"
      >
        <div className="min-w-0 overflow-hidden space-y-1">
          {displayedHeaderSegments.map((segment, index) => {
            const SegmentIcon = ACTION_ICONS[segment.iconKey] ?? Terminal;
            return (
              <div
                key={`${segment.text}-${String(index)}`}
                className="min-w-0 flex items-center gap-1.5"
              >
                <SegmentIcon
                  size={8}
                  className="shrink-0 text-muted-foreground/70"
                />
                <code
                  title={segment.tooltip ?? segment.text}
                  className="block min-w-0 flex-1 truncate whitespace-nowrap font-mono text-xs text-foreground/80 leading-4"
                >
                  {segment.text}
                </code>
              </div>
            );
          })}
          {hiddenHeaderSegmentsCount > 0 && (
            <div className="pl-[14px] text-[10px] leading-4 text-muted-foreground/70">
              +{hiddenHeaderSegmentsCount} more segment
              {hiddenHeaderSegmentsCount === 1 ? "" : "s"}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5 self-start">
          {isActive ? (
            <Loader2 size={12} className="animate-spin text-muted-foreground" />
          ) : isCompleted ? (
            isSuccess ? (
              <CheckCircle2 size={12} className="text-success" />
            ) : (
              <XCircle size={12} className="text-danger" />
            )
          ) : null}
          {item.durationMs != null && (
            <span className="text-[11px] text-muted-foreground/50 font-mono">
              {item.durationMs}ms
            </span>
          )}
          <ChevronRight
            size={12}
            className={`text-muted-foreground/60 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </Button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border divide-y divide-border/60">
              <div className="px-3 py-2 space-y-2">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Command
                  </div>
                  <CodeSnippet code={item.command} language="bash" />
                </div>
                {hasOutput ? (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Output
                    </div>
                    <CodeSnippet
                      code={output}
                      language="bash"
                      className="max-h-56 overflow-y-auto"
                    />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No output</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function areCommandBlockPropsEqual(
  prev: CommandBlockProps,
  next: CommandBlockProps,
): boolean {
  return prev.item === next.item && prev.isActive === next.isActive;
}

export const CommandBlock = memo(
  CommandBlockComponent,
  areCommandBlockPropsEqual,
);
