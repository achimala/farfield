import { useState } from "react";
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  Search,
  FolderOpen,
  FileText,
  FileSearch
} from "lucide-react";
import type { z } from "zod";
import type { CommandExecutionItemSchema } from "@codex-monitor/codex-protocol";

type CommandItem = z.infer<typeof CommandExecutionItemSchema>;

const ACTION_ICONS: Record<string, React.ElementType> = {
  search: Search,
  listFiles: FolderOpen,
  write: FileText,
  read: FileSearch,
  readFile: FileSearch,
  writeFile: FileText
};

function simplifyCommand(cmd: string): string {
  // Strip common shell wrappers: /bin/zsh -lc "..." or /bin/bash -lc "..."
  const m = /(?:\/bin\/(?:bash|zsh|sh)\s+(?:-\w+\s+)+)"?(.*?)"?\s*$/.exec(cmd);
  const simplified = m?.[1]?.replace(/\\"/g, '"').replace(/\\'/g, "'") ?? cmd;
  return simplified.length > 140 ? simplified.slice(0, 140) + "…" : simplified;
}

export function CommandBlock({ item, isActive }: { item: CommandItem; isActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = item.status === "completed";
  const isSuccess = item.exitCode === 0 || item.exitCode == null;
  const hasOutput = item.aggregatedOutput && item.aggregatedOutput.trim().length > 0;
  const hasActions = (item.commandActions?.length ?? 0) > 0;

  return (
    <div className="rounded-xl border border-border overflow-hidden text-sm">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
      >
        <Terminal size={12} className="shrink-0 text-muted-foreground" />
        <code className="flex-1 font-mono text-xs text-foreground/80 truncate min-w-0">
          {simplifyCommand(item.command)}
        </code>
        <div className="flex items-center gap-1.5 shrink-0">
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
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border divide-y divide-border/60">
          {/* Command actions */}
          {hasActions && (
            <div className="px-3 py-2 space-y-1.5">
              {item.commandActions!.map((action, i) => {
                const Icon = ACTION_ICONS[action.type] ?? Terminal;
                const label = action.name ?? action.command ?? action.path ?? action.type;
                return (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Icon size={10} className="mt-0.5 shrink-0 opacity-60" />
                    <code className="font-mono break-all leading-4">{label}</code>
                  </div>
                );
              })}
            </div>
          )}

          {/* Output */}
          {hasOutput && (
            <div className="px-3 py-2">
              <pre className="font-mono text-xs text-foreground/70 whitespace-pre-wrap break-words max-h-48 overflow-y-auto leading-5">
                {item.aggregatedOutput}
              </pre>
            </div>
          )}

          {!hasActions && !hasOutput && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No output</div>
          )}
        </div>
      )}
    </div>
  );
}
