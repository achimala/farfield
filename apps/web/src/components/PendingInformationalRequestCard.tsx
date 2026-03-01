import { motion } from "framer-motion";

export function PendingInformationalRequestCard({
  method,
}: {
  method: string;
}): React.JSX.Element {
  return (
    <motion.div
      key="pending-non-question"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-sm"
    >
      <div className="text-[10px] text-amber-700 dark:text-amber-300 uppercase tracking-wider font-medium">
        Pending Request
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{method}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        This request is active in the thread state.
      </div>
    </motion.div>
  );
}
