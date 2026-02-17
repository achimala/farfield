import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Loader2 } from "lucide-react";

interface ReasoningBlockProps {
  summary: string[];
  text?: string | undefined;
  isActive: boolean;
}

export function ReasoningBlock({ summary, text, isActive }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const currentLine = summary[summary.length - 1] ?? "Thinking…";

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group w-full text-left"
      >
        {isActive ? (
          <Loader2 size={12} className="animate-spin shrink-0 opacity-60" />
        ) : (
          <ChevronRight
            size={12}
            className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentLine}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.12 }}
            className={`text-sm truncate ${isActive ? "reasoning-shimmer" : ""}`}
          >
            {currentLine}
          </motion.span>
        </AnimatePresence>

        {!isActive && summary.length > 1 && (
          <span className="text-xs text-muted-foreground/50 shrink-0">
            {summary.length} steps
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-5 space-y-1 border-l border-border pl-3">
              {summary.map((line, i) => (
                <p key={i} className="text-xs text-muted-foreground leading-5">
                  {line}
                </p>
              ))}
              {text && (
                <div className="mt-3 pt-3 border-t border-border/60">
                  <pre className="text-[11px] text-muted-foreground/60 font-mono leading-5 whitespace-pre-wrap break-words">
                    {text}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
