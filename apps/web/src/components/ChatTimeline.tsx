import { memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown } from "lucide-react";
import type { UnifiedItem } from "@farfield/unified-surface";
import { ConversationItem } from "@/components/ConversationItem";
import { Button } from "@/components/ui/button";

export interface ChatTimelineEntry {
  key: string;
  item: UnifiedItem;
  isLast: boolean;
  turnIsInProgress: boolean;
  previousItemType: UnifiedItem["type"] | undefined;
  nextItemType: UnifiedItem["type"] | undefined;
  spacingTop: number;
}

interface ChatTimelineProps {
  selectedThreadId: string | null;
  turnsLength: number;
  hasAnyAgent: boolean;
  hasHiddenChatItems: boolean;
  firstVisibleChatItemIndex: number;
  visibleConversationItems: ChatTimelineEntry[];
  isChatAtBottom: boolean;
  onShowOlder: () => void;
  onScrollToBottom: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  chatContentRef: React.RefObject<HTMLDivElement | null>;
}

export const ChatTimeline = memo(function ChatTimeline({
  selectedThreadId,
  turnsLength,
  hasAnyAgent,
  hasHiddenChatItems,
  firstVisibleChatItemIndex,
  visibleConversationItems,
  isChatAtBottom,
  onShowOlder,
  onScrollToBottom,
  scrollRef,
  chatContentRef,
}: ChatTimelineProps): React.JSX.Element {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-4 z-10 h-10 bg-gradient-to-b from-background from-20% via-background/60 via-60% to-transparent to-100%"
      />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ overflowAnchor: "none" }}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={selectedThreadId ?? "__no_thread__"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="max-w-3xl mx-auto px-4 pt-4 pb-6"
          >
            {turnsLength === 0 ? (
              <div className="text-center py-20 text-sm text-muted-foreground">
                {selectedThreadId
                  ? "No messages yet"
                  : hasAnyAgent
                    ? "Start typing to create a new thread"
                    : "Select a thread from the sidebar"}
              </div>
            ) : (
              <motion.div
                ref={chatContentRef}
                className="space-y-0"
                layout="position"
                style={{ overflowAnchor: "none" }}
              >
                {hasHiddenChatItems && (
                  <div className="flex justify-center pb-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={onShowOlder}
                    >
                      Show older messages ({firstVisibleChatItemIndex})
                    </Button>
                  </div>
                )}
                {visibleConversationItems.map((entry) => (
                  <motion.div
                    key={entry.key}
                    layout="position"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    style={{ paddingTop: `${entry.spacingTop}px` }}
                  >
                    <ConversationItem
                      item={entry.item}
                      isLast={entry.isLast}
                      turnIsInProgress={entry.turnIsInProgress}
                      previousItemType={entry.previousItemType}
                      nextItemType={entry.nextItemType}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {!isChatAtBottom && turnsLength > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="absolute left-1/2 -translate-x-1/2 bottom-[7.25rem] md:bottom-[7.75rem] z-20"
          >
            <Button
              type="button"
              onClick={onScrollToBottom}
              size="icon"
              className="h-10 w-10 rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-muted"
            >
              <ArrowDown size={16} />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
