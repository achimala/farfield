import { motion } from "framer-motion";

interface Mode {
  mode: string;
  name: string;
  developer_instructions?: string | null;
  reasoning_effort?: string | null;
}

interface ModelOption {
  id: string;
  label: string;
}

interface PlanPanelProps {
  modes: Mode[];
  modelOptions: ModelOption[];
  effortOptions: string[];
  selectedModeKey: string;
  selectedModelId: string;
  selectedReasoningEffort: string;
  onModeChange: (key: string) => void;
  onModelChange: (id: string) => void;
  onEffortChange: (effort: string) => void;
  onApply: () => void;
  isBusy: boolean;
  hasThread: boolean;
  hasMode: boolean;
}

const selectCls =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-colors";

export function PlanPanel({
  modes,
  modelOptions,
  effortOptions,
  selectedModeKey,
  selectedModelId,
  selectedReasoningEffort,
  onModeChange,
  onModelChange,
  onEffortChange,
  onApply,
  isBusy,
  hasThread,
  hasMode
}: PlanPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-border bg-card p-3 space-y-3"
    >
      <div className="text-xs font-semibold text-foreground">Settings</div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Mode */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Mode
          </label>
          <select
            className={selectCls}
            value={selectedModeKey}
            onChange={(e) => onModeChange(e.target.value)}
          >
            {modes.map((m) => (
              <option key={m.mode} value={m.mode}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Model */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Model
          </label>
          <select
            className={selectCls}
            value={selectedModelId}
            onChange={(e) => onModelChange(e.target.value)}
          >
            <option value="">App default</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Effort */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            Effort
          </label>
          <select
            className={selectCls}
            value={selectedReasoningEffort}
            onChange={(e) => onEffortChange(e.target.value)}
          >
            <option value="">App default</option>
            {effortOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={onApply}
        disabled={!hasThread || isBusy || !hasMode}
        className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
      >
        Apply
      </button>
    </motion.div>
  );
}
