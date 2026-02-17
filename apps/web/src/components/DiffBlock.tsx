import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, FilePlus, FileMinus, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileChange {
  path: string;
  kind: { type: string; move_path?: string | null | undefined };
  diff?: string | undefined;
}

interface DiffBlockProps {
  changes: FileChange[];
}

type LineType = "add" | "remove" | "header" | "context";
interface DiffLine { type: LineType; content: string }

function parseDiff(raw: string): DiffLine[] {
  const result: DiffLine[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("@@")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+++")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("---")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      result.push({ type: "remove", content: line.slice(1) });
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      if (content) result.push({ type: "context", content });
    }
  }
  return result;
}

function kindMeta(kind: string) {
  if (kind === "create") return { Icon: FilePlus, label: "created", cls: "text-success" };
  if (kind === "delete") return { Icon: FileMinus, label: "deleted", cls: "text-danger" };
  return { Icon: FileEdit, label: "modified", cls: "text-blue-400 dark:text-blue-400" };
}

const LINE_STYLES: Record<LineType, string> = {
  add: "bg-success/8 dark:bg-success/10",
  remove: "bg-danger/8 dark:bg-danger/10",
  header: "bg-muted/60",
  context: ""
};
const TEXT_STYLES: Record<LineType, string> = {
  add: "text-success dark:text-success/90",
  remove: "text-danger dark:text-danger/90",
  header: "text-muted-foreground/60 italic",
  context: "text-foreground/70"
};
const GUTTER_STYLES: Record<LineType, string> = {
  add: "text-success/50",
  remove: "text-danger/50",
  header: "text-muted-foreground/30",
  context: "text-muted-foreground/25"
};
const GUTTER_CHAR: Record<LineType, string> = { add: "+", remove: "−", header: "", context: " " };

export function DiffBlock({ changes }: DiffBlockProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div className="rounded-xl border border-border overflow-hidden text-sm">
      {changes.map((change, i) => {
        const isExpanded = expandedIdx === i;
        const fileName = change.path.split("/").pop() ?? change.path;
        const dirPath = change.path.slice(0, change.path.lastIndexOf("/"));
        const lines = change.diff ? parseDiff(change.diff) : [];
        const added = lines.filter((line) => line.type === "add").length;
        const removed = lines.filter((line) => line.type === "remove").length;
        const { Icon, label, cls } = kindMeta(change.kind.type);

        return (
          <div key={i} className={i > 0 ? "border-t border-border" : ""}>
            <Button
              type="button"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              variant="ghost"
              className="h-auto w-full justify-start rounded-none bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/70"
            >
              <Icon size={12} className={`shrink-0 ${cls}`} />
              <span className="font-mono text-xs font-medium text-foreground truncate">{fileName}</span>
              {dirPath && (
                <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:block">
                  {dirPath}
                </span>
              )}
              <div className="flex items-center gap-2 ml-auto shrink-0">
                {added > 0 && (
                  <span className="text-xs font-mono text-success">+{added}</span>
                )}
                {removed > 0 && (
                  <span className="text-xs font-mono text-danger">−{removed}</span>
                )}
                <span className={`text-[10px] font-medium ${cls}`}>{label}</span>
                <ChevronRight
                  size={11}
                  className={`text-muted-foreground/50 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                />
              </div>
            </Button>

            <AnimatePresence initial={false}>
              {isExpanded && (
                <motion.div
                  key={`diff-${i}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border overflow-x-auto">
                    {change.diff ? (
                      lines.map((line, j) => (
                        <div
                          key={j}
                          className={`flex font-mono text-xs leading-5 ${LINE_STYLES[line.type]}`}
                        >
                          <span
                            className={`select-none w-6 text-center text-[10px] shrink-0 pt-px ${GUTTER_STYLES[line.type]}`}
                          >
                            {GUTTER_CHAR[line.type]}
                          </span>
                          <span
                            className={`flex-1 px-2 py-0.5 whitespace-pre-wrap break-all ${TEXT_STYLES[line.type]}`}
                          >
                            {line.content}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No diff available</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
