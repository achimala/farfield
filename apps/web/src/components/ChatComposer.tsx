import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, CirclePause, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ChatComposerProps = {
  canSend: boolean;
  isBusy: boolean;
  isGenerating: boolean;
  placeholder?: string;
  onInterrupt: () => void | Promise<void>;
  onSend: (text: string) => void | Promise<void>;
};

export function ChatComposer({
  canSend,
  isBusy,
  isGenerating,
  placeholder = "Message Codex…",
  onInterrupt,
  onSend
}: ChatComposerProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const previousHeightRef = useRef(0);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const maxHeight = 200;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    const currentHeight = previousHeightRef.current;

    if (currentHeight <= 0) {
      textarea.style.height = `${nextHeight}px`;
      previousHeightRef.current = nextHeight;
      return;
    }

    if (nextHeight === currentHeight) {
      textarea.style.height = `${nextHeight}px`;
      return;
    }

    textarea.style.height = `${currentHeight}px`;

    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.style.height = `${nextHeight}px`;
      resizeFrameRef.current = null;
    });
    previousHeightRef.current = nextHeight;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [resizeTextarea]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  const sendDraft = useCallback(async () => {
    if (isGenerating) {
      await onInterrupt();
      return;
    }
    if (!draft.trim() || !canSend || isBusy) {
      return;
    }

    await onSend(draft);
    setDraft("");
    previousHeightRef.current = 0;
  }, [canSend, draft, isBusy, isGenerating, onInterrupt, onSend]);

  const disableSend = isGenerating ? !canSend || isBusy : !canSend || isBusy || !draft.trim();

  return (
    <div className="flex items-end gap-2 rounded-[28px] border border-border bg-card pl-4 pr-2.5 py-2.5 focus-within:border-muted-foreground/40 transition-colors">
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          resizeTextarea();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void sendDraft();
          }
        }}
        placeholder={placeholder}
        rows={1}
        className="flex-1 min-h-9 max-h-[200px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-2 text-base leading-5 shadow-none transition-[height] duration-90 ease-out focus-visible:ring-0 md:text-sm"
      />
      <Button
        type="button"
        onClick={() => {
          void sendDraft();
        }}
        disabled={disableSend}
        size="icon"
        className={`h-9 w-9 shrink-0 self-end rounded-full disabled:opacity-30 ${
          isGenerating
            ? "bg-destructive text-destructive-foreground hover:bg-destructive/85"
            : "bg-foreground text-background hover:bg-foreground/80"
        }`}
      >
        {isGenerating ? (
          <CirclePause size={13} />
        ) : isBusy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <ArrowUp size={13} />
        )}
      </Button>
    </div>
  );
}
