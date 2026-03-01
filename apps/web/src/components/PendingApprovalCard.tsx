import { motion } from "framer-motion";
import { getPendingApprovalRequests } from "@/lib/api";
import { Button } from "@/components/ui/button";

type PendingApprovalRequest = ReturnType<typeof getPendingApprovalRequests>[number];

export function PendingApprovalCard({
  request,
  isBusy,
  onApprove,
  onDeny,
}: {
  request: PendingApprovalRequest;
  isBusy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}): React.JSX.Element {
  return (
    <motion.div
      key="pending-approval-request"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-sm"
    >
      <div className="text-[10px] text-amber-700 dark:text-amber-300 uppercase tracking-wider font-medium">
        Approval Needed
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">
        {request.method}
      </div>
      {request.method === "item/commandExecution/requestApproval" && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {request.params.reason && <div>{request.params.reason}</div>}
          {request.params.command && (
            <div className="font-mono text-[11px] text-foreground/90 break-all">
              {request.params.command}
            </div>
          )}
          {request.params.cwd && <div>cwd: {request.params.cwd}</div>}
        </div>
      )}
      {request.method === "item/fileChange/requestApproval" && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {request.params.reason && <div>{request.params.reason}</div>}
          {request.params.grantRoot && (
            <div>grant root: {request.params.grantRoot}</div>
          )}
        </div>
      )}
      {request.method === "applyPatchApproval" && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {request.params.reason && <div>{request.params.reason}</div>}
          <div>{Object.keys(request.params.fileChanges).length} file changes</div>
          {request.params.grantRoot && <div>grant root: {request.params.grantRoot}</div>}
        </div>
      )}
      {request.method === "execCommandApproval" && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {request.params.reason && <div>{request.params.reason}</div>}
          <div className="font-mono text-[11px] text-foreground/90 break-all">
            {request.params.command.join(" ")}
          </div>
          <div>cwd: {request.params.cwd}</div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={onDeny}
        >
          Deny
        </Button>
        <Button type="button" size="sm" disabled={isBusy} onClick={onApprove}>
          Approve
        </Button>
      </div>
    </motion.div>
  );
}
