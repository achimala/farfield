import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getPendingUserInputRequests } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PendingRequest = ReturnType<typeof getPendingUserInputRequests>[number];

export function PendingRequestCard({
  request,
  answerDraft,
  onDraftChange,
  onSubmit,
  onSkip,
  isBusy,
}: {
  request: PendingRequest;
  answerDraft: Record<string, { option: string; freeform: string }>;
  onDraftChange: (
    questionId: string,
    field: "option" | "freeform",
    value: string,
  ) => void;
  onSubmit: () => void;
  onSkip: () => void;
  isBusy: boolean;
}): React.JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const questions = request.params.questions;
  const currentQuestion = questions[currentIndex];

  if (!currentQuestion) return <></>;

  const draft = answerDraft[currentQuestion.id] ?? { option: "", freeform: "" };
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === questions.length - 1;

  const handleNext = () => {
    if (!isLast) {
      setDirection(1);
      setCurrentIndex((i) => i + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      setDirection(-1);
      setCurrentIndex((i) => i - 1);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4 shadow-sm"
    >
      <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wider font-medium pb-1">
        <span>{currentQuestion.header || "Question"}</span>
        <span>
          {currentIndex + 1} of {questions.length}
        </span>
      </div>

      <div
        className="flex-1 overflow-y-auto min-h-0 max-h-[40vh] px-1 -mx-1 py-2"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, black 8px, black calc(100% - 8px), transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 8px, black calc(100% - 8px), transparent)",
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentQuestion.id}
            initial={{ opacity: 0, x: direction > 0 ? 10 : -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction > 0 ? -10 : 10 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            <div className="text-sm font-medium text-foreground">
              {currentQuestion.question}
            </div>

            <RadioGroup
              value={draft.option}
              onValueChange={(value) =>
                onDraftChange(currentQuestion.id, "option", value)
              }
              className="space-y-2"
            >
              {currentQuestion.options.map((opt, optionIndex) => {
                const optionId = `q-${currentQuestion.id}-opt-${optionIndex}`;
                const isSelected = draft.option === opt.label;
                return (
                  <Label
                    key={opt.label}
                    htmlFor={optionId}
                    className={`flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-all ${
                      isSelected
                        ? "bg-primary/5 border-primary/30 text-foreground ring-1 ring-primary/20"
                        : "bg-muted/30 border-transparent hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <RadioGroupItem
                      id={optionId}
                      value={opt.label}
                      className={`mt-0.5 shrink-0 ${isSelected ? "text-primary" : ""}`}
                    />
                    <div className="text-sm min-w-0 flex-1 space-y-1">
                      <span className="font-medium block whitespace-pre-wrap break-words">
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span
                          className={`block text-xs whitespace-pre-wrap break-words ${isSelected ? "text-foreground/70" : "text-muted-foreground/70"}`}
                        >
                          {opt.description}
                        </span>
                      )}
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>

            {currentQuestion.isOther &&
              draft.option === "Type your own answer" && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="pt-2"
                >
                  <Input
                    type={currentQuestion.isSecret ? "password" : "text"}
                    value={draft.freeform}
                    onChange={(e) =>
                      onDraftChange(
                        currentQuestion.id,
                        "freeform",
                        e.target.value,
                      )
                    }
                    placeholder="Type your answer here..."
                    className="h-10 bg-background/50 text-base md:text-sm"
                    autoFocus
                  />
                </motion.div>
              )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          onClick={onSkip}
          disabled={isBusy}
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Skip All
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={handlePrev}
            disabled={isFirst || isBusy}
            variant="outline"
            size="sm"
            className="h-8 w-[84px]"
          >
            <ChevronLeft size={14} className="-ml-1 mr-1" />
            Back
          </Button>

          {isLast ? (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={isBusy}
              size="sm"
              className="h-8 w-[84px]"
            >
              Submit
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleNext}
              size="sm"
              className="h-8 w-[84px]"
            >
              Next
              <ChevronRight size={14} className="ml-1 -mr-1" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
