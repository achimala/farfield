import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { z } from "zod";
import type { JsonValue } from "@farfield/unified-surface";
import { DiffBlock } from "@/components/DiffBlock";
import { Button } from "@/components/ui/button";

const StreamEventFileChangeSchema = z
  .object({
    path: z.string(),
    kind: z
      .object({
        type: z.string(),
        movePath: z.string().nullable().optional(),
      })
      .strict(),
    diff: z.string().optional(),
  })
  .strict();

const StreamEventSchema = z
  .object({
    method: z.string().optional(),
    type: z.string().optional(),
    params: z
      .object({
        changes: z.array(StreamEventFileChangeSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function StreamEventCard({
  event,
}: {
  event: JsonValue;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const parsed = StreamEventSchema.safeParse(event);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) =>
        `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
      )
      .join(" | ");
    return (
      <div className="text-xs font-mono text-red-500 px-2 py-1.5 rounded-md border border-red-300/60 bg-red-50/40 dark:bg-red-950/20">
        {`Invalid stream event payload: ${issues}`}
      </div>
    );
  }

  const method = parsed.data.method ?? null;
  const type = parsed.data.type ?? null;
  const label = method ?? type ?? "event";
  const changes = parsed.data.params?.changes ?? [];

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Button
        type="button"
        onClick={() => setOpen((value) => !value)}
        variant="ghost"
        className="h-auto w-full justify-start rounded-none bg-muted/30 px-2.5 py-1.5 text-left hover:bg-muted/60"
      >
        <ChevronRight
          size={10}
          className={`shrink-0 text-muted-foreground/60 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-[11px] text-muted-foreground truncate">
          {label}
        </span>
      </Button>
      {open && (
        <div className="border-t border-border px-2.5 py-2">
          {changes.length > 0 ? (
            <DiffBlock changes={changes} />
          ) : (
            <pre className="font-mono text-[11px] text-muted-foreground/80 whitespace-pre-wrap break-words">
              {JSON.stringify(event, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
