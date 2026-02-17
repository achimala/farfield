import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bug,
  ChevronRight,
  CirclePause,
  Loader2,
  Menu,
  Moon,
  PanelLeft,
  RefreshCcw,
  Settings2,
  Sun,
  X
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  getHealth,
  getHistoryEntry,
  getLiveState,
  getPendingUserInputRequests,
  getStreamEvents,
  getTraceStatus,
  interruptThread,
  listCollaborationModes,
  listModels,
  listDebugHistory,
  listThreads,
  markTrace,
  replayHistoryEntry,
  sendMessage,
  setCollaborationMode,
  startTrace,
  stopTrace,
  submitUserInput
} from "@/lib/api";
import { useTheme } from "@/hooks/useTheme";
import { ConversationItem } from "@/components/ConversationItem";
import { PlanPanel } from "@/components/PlanPanel";
import { DiffBlock } from "@/components/DiffBlock";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";

/* ── Types ─────────────────────────────────────────────────── */
type Health = Awaited<ReturnType<typeof getHealth>>;
type ThreadsResponse = Awaited<ReturnType<typeof listThreads>>;
type ModesResponse = Awaited<ReturnType<typeof listCollaborationModes>>;
type ModelsResponse = Awaited<ReturnType<typeof listModels>>;
type LiveStateResponse = Awaited<ReturnType<typeof getLiveState>>;
type StreamEventsResponse = Awaited<ReturnType<typeof getStreamEvents>>;
type TraceStatus = Awaited<ReturnType<typeof getTraceStatus>>;
type HistoryResponse = Awaited<ReturnType<typeof listDebugHistory>>;
type HistoryDetail = Awaited<ReturnType<typeof getHistoryEntry>>;
type PendingRequest = ReturnType<typeof getPendingUserInputRequests>[number];
type Thread = ThreadsResponse["data"][number];

/* ── Helpers ────────────────────────────────────────────────── */
function formatDate(value: number | string | null | undefined): string {
  if (typeof value === "number") return new Date(value * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return value;
  }
  return "";
}

function threadLabel(thread: Thread): string {
  const text = thread.preview.trim();
  if (!text) return `thread ${thread.id.slice(0, 8)}`;
  return text;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DEFAULT_EFFORT_OPTIONS = ["minimal", "low", "medium", "high", "xhigh"] as const;

/* ── Small UI atoms ─────────────────────────────────────────── */
function StatusDot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          ok === undefined ? "bg-muted-foreground/40" : ok ? "bg-success" : "bg-danger"
        }`}
      />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function IconBtn({
  onClick,
  disabled,
  title,
  active,
  children
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const buttonNode = (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant="ghost"
      size="icon"
      className={`h-8 w-8 rounded-lg ${
        active
          ? "bg-muted text-foreground hover:bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </Button>
  );

  if (!title) {
    return buttonNode;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttonNode}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

/* ── Stream event renderer ──────────────────────────────────── */
function StreamEventCard({ event }: { event: unknown }) {
  const [open, setOpen] = useState(false);
  if (typeof event !== "object" || event === null) {
    return (
      <div className="text-xs font-mono text-muted-foreground px-2 py-1.5 rounded-md border border-border">
        {String(event)}
      </div>
    );
  }
  const e = event as Record<string, unknown>;
  const method = typeof e["method"] === "string" ? e["method"] : null;
  const type = typeof e["type"] === "string" ? e["type"] : null;
  const label = method ?? type ?? "event";

  const params = e["params"] as Record<string, unknown> | undefined;
  const changes = params?.["changes"];
  const isFileChange = Array.isArray(changes);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        variant="ghost"
        className="h-auto w-full justify-start rounded-none bg-muted/30 px-2.5 py-1.5 text-left hover:bg-muted/60"
      >
        <ChevronRight
          size={10}
          className={`shrink-0 text-muted-foreground/60 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-[11px] text-muted-foreground truncate">{label}</span>
      </Button>
      {open && (
        <div className="border-t border-border px-2.5 py-2">
          {isFileChange ? (
            <DiffBlock
              changes={
                changes as Array<{
                  path: string;
                  kind: { type: string; move_path?: string | null };
                  diff?: string;
                }>
              }
            />
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

/* ── Pending user input ─────────────────────────────────────── */
function PendingRequestCard({
  request,
  answerDraft,
  onDraftChange,
  onSubmit,
  onSkip,
  isBusy
}: {
  request: PendingRequest;
  answerDraft: Record<string, { option: string; freeform: string }>;
  onDraftChange: (questionId: string, field: "option" | "freeform", value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  isBusy: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-4 space-y-3"
    >
      {request.params.questions.map((q) => {
        const draft = answerDraft[q.id] ?? { option: "", freeform: "" };
        return (
          <div key={q.id} className="space-y-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              {q.header}
            </div>
            <div className="text-sm font-medium text-foreground">{q.question}</div>
            <div className="space-y-1">
              <RadioGroup
                value={draft.option}
                onValueChange={(value) => onDraftChange(q.id, "option", value)}
                className="space-y-1"
              >
                {q.options.map((opt, optionIndex) => {
                  const optionId = `q-${q.id}-opt-${optionIndex}`;
                  return (
                    <Label
                      key={opt.label}
                      htmlFor={optionId}
                      className={`flex items-start gap-2.5 cursor-pointer p-2 rounded-lg transition-colors ${
                        draft.option === opt.label
                          ? "bg-muted text-foreground"
                          : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <RadioGroupItem
                        id={optionId}
                        value={opt.label}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="text-sm">
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="block text-xs text-muted-foreground/70 mt-0.5">
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            </div>
            {q.isOther && (
              <Input
                type={q.isSecret ? "password" : "text"}
                value={draft.freeform}
                onChange={(e) => onDraftChange(q.id, "freeform", e.target.value)}
                placeholder="Free-form answer…"
                className="h-8 bg-background text-sm"
              />
            )}
          </div>
        );
      })}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          onClick={onSkip}
          disabled={isBusy}
          variant="outline"
          size="sm"
          className="h-8 text-xs"
        >
          Skip
        </Button>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isBusy}
          size="sm"
          className="h-8 text-xs"
        >
          Submit
        </Button>
      </div>
    </motion.div>
  );
}

/* ── Main App ───────────────────────────────────────────────── */
export function App(): React.JSX.Element {
  const { theme, toggle: toggleTheme } = useTheme();

  /* State */
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [threads, setThreads] = useState<ThreadsResponse["data"]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveStateResponse | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEventsResponse["events"]>([]);
  const [modes, setModes] = useState<ModesResponse["data"]>([]);
  const [models, setModels] = useState<ModelsResponse["data"]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [selectedModeKey, setSelectedModeKey] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [traceStatus, setTraceStatus] = useState<TraceStatus | null>(null);
  const [traceLabel, setTraceLabel] = useState("capture");
  const [traceNote, setTraceNote] = useState("");
  const [history, setHistory] = useState<HistoryResponse["history"]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);
  const [waitForReplayResponse, setWaitForReplayResponse] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [answerDraft, setAnswerDraft] = useState<Record<string, { option: string; freeform: string }>>({});

  /* UI state */
  const [activeTab, setActiveTab] = useState<"chat" | "debug">("chat");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [planOpen, setPlanOpen] = useState(false);
  const [isChatAtBottom, setIsChatAtBottom] = useState(true);

  /* Refs */
  const selectedThreadIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const coreRefreshIntervalRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* Derived */
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  const pendingRequests = useMemo(() => {
    if (!liveState?.conversationState) return [] as PendingRequest[];
    return getPendingUserInputRequests(liveState.conversationState);
  }, [liveState]);

  const activeRequest = useMemo(() => {
    if (!pendingRequests.length) return null;
    if (selectedRequestId === null) return pendingRequests[0];
    return pendingRequests.find((r) => r.id === selectedRequestId) ?? pendingRequests[0];
  }, [pendingRequests, selectedRequestId]);

  const selectedMode = useMemo(
    () => modes.find((m) => m.mode === selectedModeKey) ?? null,
    [modes, selectedModeKey]
  );

  const effortOptions = useMemo(() => {
    const vals = new Set<string>(DEFAULT_EFFORT_OPTIONS);
    for (const m of modes) if (m.reasoning_effort) vals.add(m.reasoning_effort);
    const le = liveState?.conversationState?.latestReasoningEffort;
    if (le) vals.add(le);
    if (selectedReasoningEffort) vals.add(selectedReasoningEffort);
    return Array.from(vals);
  }, [liveState?.conversationState?.latestReasoningEffort, modes, selectedReasoningEffort]);

  const modelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) {
      const label =
        m.displayName && m.displayName !== m.id
          ? `${m.displayName} (${m.id})`
          : m.displayName || m.id;
      map.set(m.id, label);
    }
    const lm = liveState?.conversationState?.latestModel;
    if (lm && !map.has(lm)) map.set(lm, lm);
    if (selectedModelId && !map.has(selectedModelId)) map.set(selectedModelId, selectedModelId);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [liveState?.conversationState?.latestModel, models, selectedModelId]);

  const turns = liveState?.conversationState?.turns ?? [];
  const conversationItemCount = useMemo(
    () => turns.reduce((count, turn) => count + (turn.items?.length ?? 0), 0),
    [turns]
  );
  const lastTurn = turns[turns.length - 1];
  const isGenerating = lastTurn?.status === "in-progress";

  /* Data loading */
  const loadCoreData = useCallback(async () => {
    const [nh, nt, nm, nmo, ntr, nhist] = await Promise.all([
      getHealth(),
      listThreads({ limit: 80, archived: false, all: true, maxPages: 20 }),
      listCollaborationModes(),
      listModels(),
      getTraceStatus(),
      listDebugHistory(120)
    ]);
    setHealth(nh);
    setThreads(nt.data);
    setModes(nm.data);
    setModels(nmo.data);
    setTraceStatus(ntr);
    setHistory(nhist.history);
    setSelectedThreadId((cur) => {
      if (cur && nt.data.some((t) => t.id === cur)) return cur;
      return nt.data[0]?.id ?? null;
    });
    setSelectedModeKey((cur) => {
      if (cur) return cur;
      return nm.data[0]?.mode ?? "";
    });
  }, []);

  const loadSelectedThread = useCallback(async (threadId: string) => {
    const [live, stream] = await Promise.all([getLiveState(threadId), getStreamEvents(threadId)]);
    setLiveState(live);
    setStreamEvents(stream.events);
  }, []);

  const loadLiveData = useCallback(async () => {
    const [nh, nhist] = await Promise.all([getHealth(), listDebugHistory(120)]);
    setHealth(nh);
    setHistory(nhist.history);
    if (selectedThreadIdRef.current) {
      await loadSelectedThread(selectedThreadIdRef.current);
    }
  }, [loadSelectedThread]);

  const refreshAll = useCallback(async () => {
    try {
      setError("");
      await loadCoreData();
      if (selectedThreadIdRef.current) await loadSelectedThread(selectedThreadIdRef.current);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, [loadCoreData, loadSelectedThread]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    coreRefreshIntervalRef.current = window.setInterval(() => {
      void loadCoreData().catch((e) => setError(toErrorMessage(e)));
    }, 5000);
    return () => {
      if (coreRefreshIntervalRef.current) window.clearInterval(coreRefreshIntervalRef.current);
    };
  }, [loadCoreData]);

  useEffect(() => {
    if (!selectedThreadId) {
      setLiveState(null);
      setStreamEvents([]);
      return;
    }
    void loadSelectedThread(selectedThreadId).catch((e) => setError(toErrorMessage(e)));
  }, [loadSelectedThread, selectedThreadId]);

  useEffect(() => {
    const source = new EventSource("/events");
    source.onmessage = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void loadLiveData().catch((e) => setError(toErrorMessage(e)));
      }, 800);
    };
    source.onerror = () => source.close();
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      source.close();
    };
  }, [loadLiveData]);

  useEffect(() => {
    if (!activeRequest) {
      setSelectedRequestId(null);
      setAnswerDraft({});
      return;
    }
    setSelectedRequestId((cur) => cur ?? activeRequest.id);
    setAnswerDraft((prev) => {
      const next: Record<string, { option: string; freeform: string }> = {};
      for (const q of activeRequest.params.questions) {
        next[q.id] = prev[q.id] ?? { option: "", freeform: "" };
      }
      return next;
    });
  }, [activeRequest]);

  useEffect(() => {
    const cs = liveState?.conversationState;
    if (!cs) return;
    const lm = cs.latestCollaborationMode;
    if (lm?.mode) setSelectedModeKey(lm.mode);
    setSelectedModelId(lm?.settings.model ?? cs.latestModel ?? "");
    setSelectedReasoningEffort(lm?.settings.reasoning_effort ?? cs.latestReasoningEffort ?? "");
  }, [liveState]);

  // Track whether chat view is at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) {
      return;
    }

    const scroller = scrollRef.current;
    const updateBottomState = () => {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      setIsChatAtBottom(distanceFromBottom <= 48);
    };

    updateBottomState();
    scroller.addEventListener("scroll", updateBottomState, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", updateBottomState);
    };
  }, [activeTab, selectedThreadId]);

  // Keep chat pinned to bottom only if user is already at the bottom.
  useEffect(() => {
    if (activeTab === "chat" && isChatAtBottom && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [activeTab, conversationItemCount, isChatAtBottom]);

  // New thread selection starts at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setIsChatAtBottom(true);
  }, [activeTab, selectedThreadId]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [messageDraft]);

  /* Actions */
  const submitMessage = useCallback(async () => {
    if (!selectedThreadId || !messageDraft.trim()) return;
    setIsBusy(true);
    try {
      setError("");
      const ownerOpts = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await sendMessage({ threadId: selectedThreadId, ...ownerOpts, text: messageDraft });
      setMessageDraft("");
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [liveState?.ownerClientId, messageDraft, refreshAll, selectedThreadId]);

  const applyMode = useCallback(async () => {
    if (!selectedThreadId || !selectedMode) return;
    setIsBusy(true);
    try {
      setError("");
      const ownerOpts = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await setCollaborationMode({
        threadId: selectedThreadId,
        ...ownerOpts,
        collaborationMode: {
          mode: selectedMode.mode,
          settings: {
            model: selectedModelId || null,
            reasoning_effort: selectedReasoningEffort || null,
            developer_instructions: selectedMode.developer_instructions ?? null
          }
        }
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [liveState?.ownerClientId, refreshAll, selectedMode, selectedModelId, selectedReasoningEffort, selectedThreadId]);

  const submitPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    const answers: Record<string, { answers: string[] }> = {};
    for (const q of activeRequest.params.questions) {
      const cur = answerDraft[q.id] ?? { option: "", freeform: "" };
      const text = cur.option || cur.freeform.trim();
      if (text) answers[q.id] = { answers: [text] };
    }
    setIsBusy(true);
    try {
      setError("");
      const ownerOpts = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await submitUserInput({
        threadId: selectedThreadId,
        ...ownerOpts,
        requestId: activeRequest.id,
        response: { answers }
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, answerDraft, liveState?.ownerClientId, refreshAll, selectedThreadId]);

  const skipPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    setIsBusy(true);
    try {
      setError("");
      const ownerOpts = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await submitUserInput({
        threadId: selectedThreadId,
        ...ownerOpts,
        requestId: activeRequest.id,
        response: { answers: {} }
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, liveState?.ownerClientId, refreshAll, selectedThreadId]);

  const runInterrupt = useCallback(async () => {
    if (!selectedThreadId) return;
    setIsBusy(true);
    try {
      setError("");
      const ownerOpts = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await interruptThread({ threadId: selectedThreadId, ...ownerOpts });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [liveState?.ownerClientId, refreshAll, selectedThreadId]);

  const loadHistoryDetail = useCallback(async (id: string) => {
    if (!id) { setHistoryDetail(null); return; }
    const detail = await getHistoryEntry(id);
    setHistoryDetail(detail);
  }, []);

  useEffect(() => {
    void loadHistoryDetail(selectedHistoryId).catch((e) => setError(toErrorMessage(e)));
  }, [loadHistoryDetail, selectedHistoryId]);

  const handleAnswerChange = useCallback(
    (questionId: string, field: "option" | "freeform", value: string) => {
      setAnswerDraft((prev) => ({
        ...prev,
        [questionId]: { ...(prev[questionId] ?? { option: "", freeform: "" }), [field]: value }
      }));
    },
    []
  );

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <TooltipProvider delayDuration={120}>
      <LayoutGroup>
      <div className="h-screen flex overflow-hidden bg-background text-foreground font-sans">

      {/* Mobile sidebar backdrop */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={`fixed md:relative z-50 flex flex-col h-full border-r border-sidebar-border bg-sidebar shrink-0 transition-transform duration-200 ease-in-out md:transition-[width,opacity] md:duration-200 md:translate-x-0 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          desktopSidebarOpen
            ? "w-64 md:w-64 md:opacity-100 md:pointer-events-auto"
            : "w-64 md:w-0 md:opacity-0 md:pointer-events-none"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-foreground/90 shrink-0" />
            <span className="text-sm font-semibold">Codex Monitor</span>
          </div>
          <div className="flex items-center gap-1">
            <AnimatePresence initial={false}>
              {desktopSidebarOpen && (
                <motion.div
                  key="desktop-toggle-in-sidebar"
                  layoutId="desktop-sidebar-toggle"
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="hidden md:block"
                >
                  <IconBtn onClick={() => setDesktopSidebarOpen(false)} title="Hide sidebar">
                    <PanelLeft size={15} />
                  </IconBtn>
                </motion.div>
              )}
            </AnimatePresence>
            <Button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              variant="ghost"
              size="icon"
              className="md:hidden h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
          {threads.length === 0 && (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">No threads</div>
          )}
          {threads.map((thread) => {
            const isSelected = thread.id === selectedThreadId;
            return (
              <Button
                key={thread.id}
                type="button"
                onClick={() => {
                  setSelectedThreadId(thread.id);
                  setMobileSidebarOpen(false);
                }}
                variant="ghost"
                className={`w-full min-w-0 h-auto flex items-center justify-between gap-2 rounded-xl px-3 py-3 text-left transition-colors ${
                  isSelected
                    ? "bg-muted/90 text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
              >
                <span className="min-w-0 flex-1 text-xs truncate leading-5">{threadLabel(thread)}</span>
                {thread.updatedAt && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                    {formatDate(thread.updatedAt)}
                  </span>
                )}
              </Button>
            );
          })}
        </div>

        {/* Sidebar footer — status */}
        <div className="p-4 border-t border-sidebar-border space-y-2 shrink-0">
          <StatusDot ok={health?.state.appReady} label="App" />
          <StatusDot ok={health?.state.ipcConnected} label="IPC" />
          <StatusDot ok={health?.state.ipcInitialized} label="Init" />
          {liveState?.ownerClientId && (
            <div className="text-[10px] text-muted-foreground/50 font-mono pt-1">
              {liveState.ownerClientId.slice(0, 8)}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="flex items-center justify-between px-3 h-14 border-b border-border shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="md:hidden">
              <IconBtn onClick={() => setMobileSidebarOpen(true)} title="Threads">
                <Menu size={15} />
              </IconBtn>
            </div>
            <AnimatePresence initial={false}>
              {!desktopSidebarOpen && (
                <motion.div
                  key="desktop-toggle-in-header"
                  layoutId="desktop-sidebar-toggle"
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="hidden md:block"
                >
                  <IconBtn onClick={() => setDesktopSidebarOpen(true)} title="Show sidebar">
                    <PanelLeft size={15} />
                  </IconBtn>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate leading-5">
                {selectedThread ? threadLabel(selectedThread) : "No thread selected"}
              </div>
              {isGenerating && (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 size={9} className="animate-spin" />
                  <span>generating</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <IconBtn
              onClick={() => void refreshAll()}
              disabled={isBusy}
              title="Refresh"
            >
              <RefreshCcw size={14} className={isBusy ? "animate-spin" : ""} />
            </IconBtn>
            <IconBtn
              onClick={() => void runInterrupt()}
              disabled={!selectedThreadId || isBusy}
              title="Interrupt"
            >
              <CirclePause size={14} />
            </IconBtn>
            <IconBtn
              onClick={() => setActiveTab(activeTab === "debug" ? "chat" : "debug")}
              active={activeTab === "debug"}
              title="Debug"
            >
              <Bug size={14} />
            </IconBtn>
            <IconBtn onClick={toggleTheme} title="Toggle theme">
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </IconBtn>
          </div>
        </header>

        {/* Error bar */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden shrink-0"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive">
                <span className="truncate">{error}</span>
                <Button
                  type="button"
                  onClick={() => setError("")}
                  variant="ghost"
                  size="icon"
                  className="ml-3 h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
                >
                  <X size={13} />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Chat tab ──────────────────────────────────────── */}
        {activeTab === "chat" && (
          <div className="relative flex-1 flex flex-col min-h-0">

            {/* Conversation */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 py-8">
                {turns.length === 0 ? (
                  <div className="text-center py-20 text-sm text-muted-foreground">
                    {selectedThreadId ? "No messages yet" : "Select a thread from the sidebar"}
                  </div>
                ) : (
                  <motion.div layout className="space-y-8">
                    {turns.map((turn, ti) => {
                      const isLastTurn = ti === turns.length - 1;
                      const turnInProgress = isLastTurn && isGenerating;
                      const items = turn.items ?? [];
                      return (
                        <motion.div layout key={turn.turnId ?? ti} className="space-y-5">
                          <AnimatePresence initial={false}>
                          {items.map((item, ii) => (
                            <motion.div
                              layout
                              key={item.id ?? `${ti}-${ii}`}
                              initial={{ opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -8 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                            >
                              <ConversationItem
                                item={item}
                                isLast={ii === items.length - 1}
                                turnIsInProgress={turnInProgress}
                                previousItemType={items[ii - 1]?.type}
                                nextItemType={items[ii + 1]?.type}
                              />
                            </motion.div>
                          ))}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </div>
            </div>

            <AnimatePresence initial={false}>
              {!isChatAtBottom && turns.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-1/2 -translate-x-1/2 bottom-[7.25rem] md:bottom-[7.75rem] z-20"
                >
                  <Button
                    type="button"
                    onClick={() => {
                      if (!scrollRef.current) return;
                      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                      setIsChatAtBottom(true);
                    }}
                    size="icon"
                    className="h-10 w-10 rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-muted"
                  >
                    <ArrowDown size={16} />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div className="border-t border-border px-4 py-4 shrink-0">
              <div className="max-w-3xl mx-auto space-y-2">

                {/* Pending user input */}
                <AnimatePresence>
                  {activeRequest && (
                    <PendingRequestCard
                      request={activeRequest}
                      answerDraft={answerDraft}
                      onDraftChange={handleAnswerChange}
                      onSubmit={() => void submitPendingRequest()}
                      onSkip={() => void skipPendingRequest()}
                      isBusy={isBusy}
                    />
                  )}
                </AnimatePresence>

                {/* Plan panel */}
                <AnimatePresence>
                  {planOpen && (
                    <PlanPanel
                      modes={modes}
                      modelOptions={modelOptions}
                      effortOptions={effortOptions}
                      selectedModeKey={selectedModeKey}
                      selectedModelId={selectedModelId}
                      selectedReasoningEffort={selectedReasoningEffort}
                      onModeChange={setSelectedModeKey}
                      onModelChange={setSelectedModelId}
                      onEffortChange={setSelectedReasoningEffort}
                      onApply={() => void applyMode()}
                      isBusy={isBusy}
                      hasThread={!!selectedThreadId}
                      hasMode={!!selectedMode}
                    />
                  )}
                </AnimatePresence>

                {/* Composer */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-3 focus-within:border-muted-foreground/40 transition-colors">
                    <Textarea
                      ref={textareaRef}
                      value={messageDraft}
                      onChange={(e) => setMessageDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void submitMessage();
                        }
                      }}
                      placeholder="Message Codex…"
                      rows={1}
                      className="flex-1 min-h-[22px] max-h-[200px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-6 shadow-none focus-visible:ring-0"
                    />
                    <Button
                      type="button"
                      onClick={() => void submitMessage()}
                      disabled={!selectedThreadId || isBusy || !messageDraft.trim()}
                      size="icon"
                      className="h-7 w-7 shrink-0 bg-foreground text-background hover:bg-foreground/80 disabled:opacity-30"
                    >
                      {isBusy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <ArrowUp size={13} />
                      )}
                    </Button>
                  </div>

                  {/* Toolbar */}
                  <div className="flex items-center gap-2 px-1">
                    <Button
                      type="button"
                      onClick={() => setPlanOpen((v) => !v)}
                      variant="ghost"
                      size="sm"
                      className={`rounded-full text-xs ${
                        planOpen
                          ? "bg-muted text-foreground hover:bg-muted"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <Settings2 size={11} />
                      Plan mode
                    </Button>
                    {pendingRequests.length > 0 && (
                      <span className="text-xs text-amber-500 dark:text-amber-400">
                        {pendingRequests.length} pending
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground/40 select-none">
                      ⌘↵ send
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Debug tab ─────────────────────────────────────── */}
        {activeTab === "debug" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px] min-h-0 divide-y md:divide-y-0 md:divide-x divide-border overflow-hidden">

              {/* Left: History */}
              <div className="flex flex-col min-h-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                  <Activity size={13} className="text-muted-foreground" />
                  <span className="text-sm font-medium">History</span>
                  <span className="text-xs text-muted-foreground/60">{history.length} entries</span>
                </div>

                <div className="flex-1 grid grid-cols-[200px_minmax(0,1fr)] min-h-0 divide-x divide-border overflow-hidden">
                  {/* Entry list */}
                  <div className="overflow-y-auto py-1">
                    {history
                      .slice()
                      .reverse()
                      .map((entry) => (
                        <Button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedHistoryId(entry.id)}
                          variant="ghost"
                          className={`w-full h-auto flex-col items-start justify-start gap-0 rounded-none px-3 py-2 text-left transition-colors ${
                            selectedHistoryId === entry.id
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase leading-4 ${
                                entry.direction === "in"
                                  ? "bg-success/15 text-success"
                                  : entry.direction === "out"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {entry.source} {entry.direction}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground/50 font-mono truncate">
                            {entry.at}
                          </div>
                        </Button>
                      ))}
                  </div>

                  {/* Payload detail */}
                  <div className="overflow-y-auto p-3 space-y-3">
                    {!historyDetail ? (
                      <div className="text-xs text-muted-foreground py-4">Select an entry</div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor="wait-for-replay-response"
                            className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground cursor-pointer"
                          >
                            <Checkbox
                              id="wait-for-replay-response"
                              checked={waitForReplayResponse}
                              onCheckedChange={(checked) =>
                                setWaitForReplayResponse(checked === true)
                              }
                            />
                            wait for response
                          </Label>
                          <Button
                            type="button"
                            onClick={() =>
                              void replayHistoryEntry({
                                entryId: historyDetail.entry.id,
                                waitForResponse: waitForReplayResponse
                              }).then(refreshAll)
                            }
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            Replay
                          </Button>
                        </div>
                        <pre className="font-mono text-[11px] text-muted-foreground leading-5 whitespace-pre-wrap break-words">
                          {JSON.stringify(historyDetail.fullPayload, null, 2)}
                        </pre>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Trace + Stream Events */}
              <div className="flex flex-col min-h-0 overflow-hidden divide-y divide-border">

                {/* Trace controls */}
                <div className="p-4 space-y-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Trace</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        traceStatus?.active
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {traceStatus?.active ? "recording" : "idle"}
                    </span>
                  </div>
                  <Input
                    value={traceLabel}
                    onChange={(e) => setTraceLabel(e.target.value)}
                    placeholder="label"
                    className="h-7 text-xs"
                  />
                  <Input
                    value={traceNote}
                    onChange={(e) => setTraceNote(e.target.value)}
                    placeholder="marker note"
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-1.5">
                    {(["Start", "Mark", "Stop"] as const).map((btn) => (
                      <Button
                        key={btn}
                        type="button"
                        onClick={() => {
                          const action =
                            btn === "Start"
                              ? startTrace(traceLabel)
                              : btn === "Mark"
                              ? markTrace(traceNote)
                              : stopTrace();
                          void action.then(refreshAll);
                        }}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                      >
                        {btn}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Stream events */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
                    <span className="text-xs font-medium">Stream Events</span>
                    <span className="text-xs text-muted-foreground/60">{streamEvents.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                    {streamEvents
                      .slice()
                      .reverse()
                      .map((evt, i) => (
                        <StreamEventCard key={i} event={evt} />
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
      </LayoutGroup>
    </TooltipProvider>
  );
}
