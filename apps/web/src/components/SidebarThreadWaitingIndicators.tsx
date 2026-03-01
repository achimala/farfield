export function SidebarThreadWaitingIndicators({
  waitingOnApproval,
  waitingOnUserInput,
}: {
  waitingOnApproval: boolean;
  waitingOnUserInput: boolean;
}): React.JSX.Element {
  if (!waitingOnApproval && !waitingOnUserInput) {
    return <></>;
  }

  return (
    <span className="shrink-0 flex items-center gap-0.5">
      {waitingOnApproval && (
        <span
          title="Waiting for approval"
          className="rounded-full border border-amber-500/40 bg-amber-500/15 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
        >
          Approval
        </span>
      )}
      {waitingOnUserInput && (
        <span
          title="Waiting for user input"
          className="rounded-full border border-sky-500/40 bg-sky-500/15 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300"
        >
          Input
        </span>
      )}
    </span>
  );
}
