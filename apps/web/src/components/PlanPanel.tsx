import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const APP_DEFAULT_VALUE = "__app_default__";

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
  hasMode,
}: PlanPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-border bg-card p-4 space-y-4"
    >
      <div className="text-sm font-medium">Settings</div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Mode */}
        <div className="space-y-2">
          <Label htmlFor="plan-mode">Mode</Label>
          <Select value={selectedModeKey} onValueChange={onModeChange}>
            <SelectTrigger id="plan-mode" className="w-full">
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent position="popper">
              {modes.map((m) => (
                <SelectItem key={m.mode} value={m.mode}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Model */}
        <div className="space-y-2">
          <Label htmlFor="plan-model">Model</Label>
          <Select
            value={selectedModelId || APP_DEFAULT_VALUE}
            onValueChange={(value) =>
              onModelChange(value === APP_DEFAULT_VALUE ? "" : value)
            }
          >
            <SelectTrigger id="plan-model" className="w-full">
              <SelectValue placeholder="App default" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={APP_DEFAULT_VALUE}>App default</SelectItem>
              {modelOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Effort */}
        <div className="space-y-2">
          <Label htmlFor="plan-effort">Effort</Label>
          <Select
            value={selectedReasoningEffort || APP_DEFAULT_VALUE}
            onValueChange={(value) =>
              onEffortChange(value === APP_DEFAULT_VALUE ? "" : value)
            }
          >
            <SelectTrigger id="plan-effort" className="w-full">
              <SelectValue placeholder="App default" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={APP_DEFAULT_VALUE}>App default</SelectItem>
              {effortOptions.map((e) => (
                <SelectItem key={e} value={e}>
                  {e}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        type="button"
        onClick={onApply}
        disabled={!hasThread || isBusy || !hasMode}
        className="w-fit"
      >
        Apply
      </Button>
    </motion.div>
  );
}
