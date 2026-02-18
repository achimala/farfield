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
  Bug,
  Circle,
  CircleDot,
  Folder,
  FolderOpen,
  Github,
  Loader2,
  Menu,
  Moon,
  PanelLeft,
  Plus,
  RefreshCcw,
  Sun,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import {
  createThread,
  getHealth,
  getHistoryEntry,
  getLiveState,
  getPendingUserInputRequests,
  getStreamEvents,
  readThread,
  getTraceStatus,
  interruptThread,
  listAgents,
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
  submitUserInput,
  type AgentKind
} from "@/lib/api";
import { useTheme } from "@/hooks/useTheme";
import { ConversationItem } from "@/components/ConversationItem";
import { ChatComposer } from "@/components/ChatComposer";
import { PendingRequestCard } from "@/components/PendingRequestCard";
import { StreamEventCard } from "@/components/StreamEventCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

/* ── Types ─────────────────────────────────────────────────── */
type Health = Awaited<ReturnType<typeof getHealth>>;
type ThreadsResponse = Awaited<ReturnType<typeof listThreads>>;
type ModesResponse = Awaited<ReturnType<typeof listCollaborationModes>>;
type ModelsResponse = Awaited<ReturnType<typeof listModels>>;
type LiveStateResponse = Awaited<ReturnType<typeof getLiveState>>;
type StreamEventsResponse = Awaited<ReturnType<typeof getStreamEvents>>;
type ReadThreadResponse = Awaited<ReturnType<typeof readThread>>;
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
const INITIAL_VISIBLE_CHAT_ITEMS = 180;
const VISIBLE_CHAT_ITEMS_STEP = 120;
const APP_DEFAULT_VALUE = "__app_default__";
const ASSUMED_APP_DEFAULT_MODEL = "gpt-5.3-codex";
const ASSUMED_APP_DEFAULT_EFFORT = "medium";
const SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY = "farfield.sidebar.collapsed-groups.v1";

function isPlanModeOption(mode: { mode: string; name: string }): boolean {
  return mode.mode.toLowerCase().includes("plan") || mode.name.toLowerCase().includes("plan");
}

function getConversationStateUpdatedAt(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined
): number {
  if (!state || typeof state.updatedAt !== "number") {
    return Number.NEGATIVE_INFINITY;
  }
  return state.updatedAt;
}

function buildModeSignature(modeKey: string, modelId: string, effort: string): string {
  return `${modeKey}|${modelId}|${effort}`;
}

function normalizeNullableModeValue(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : "";
}

function normalizeModeSettingValue(
  value: string | null | undefined,
  assumedDefault: string
): string {
  const normalized = normalizeNullableModeValue(value);
  if (!normalized) {
    return "";
  }
  if (normalized === assumedDefault) {
    return "";
  }
  return normalized;
}

function readModeSelectionFromConversationState(state: NonNullable<ReadThreadResponse["thread"]> | null): {
  modeKey: string;
  modelId: string;
  reasoningEffort: string;
} {
  if (!state) {
    return {
      modeKey: "",
      modelId: "",
      reasoningEffort: ""
    };
  }

  if (state.latestCollaborationMode) {
    return {
      modeKey: state.latestCollaborationMode.mode,
      modelId: normalizeModeSettingValue(
        state.latestCollaborationMode.settings.model,
        ASSUMED_APP_DEFAULT_MODEL
      ),
      reasoningEffort: normalizeModeSettingValue(
        state.latestCollaborationMode.settings.reasoning_effort,
        ASSUMED_APP_DEFAULT_EFFORT
      )
    };
  }

  return {
    modeKey: "",
    modelId: normalizeModeSettingValue(state.latestModel, ASSUMED_APP_DEFAULT_MODEL),
    reasoningEffort: normalizeModeSettingValue(state.latestReasoningEffort, ASSUMED_APP_DEFAULT_EFFORT)
  };
}

function basenameFromPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalized) {
    return value;
  }
  const parts = normalized.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? normalized;
}

function readSidebarCollapsedGroupsFromStorage(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const storage = window.localStorage as Partial<Storage> | undefined;
    if (!storage || typeof storage.getItem !== "function") {
      return {};
    }
    const raw = storage.getItem(SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const collapsed: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") {
        collapsed[key] = value;
      }
    }
    return collapsed;
  } catch {
    return {};
  }
}

function writeSidebarCollapsedGroupsToStorage(value: Record<string, boolean>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const storage = window.localStorage as Partial<Storage> | undefined;
    if (!storage || typeof storage.setItem !== "function") {
      return;
    }
    storage.setItem(SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage errors.
  }
}

function parseUiStateFromPath(pathname: string): { threadId: string | null; tab: "chat" | "debug" } {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { threadId: null, tab: "chat" };
  }
  if (segments.length === 1 && segments[0] === "debug") {
    return { threadId: null, tab: "debug" };
  }
  if (segments[0] === "threads" && typeof segments[1] === "string" && segments[1].length > 0) {
    const threadId = decodeURIComponent(segments[1]);
    if (segments[2] === "debug") {
      return { threadId, tab: "debug" };
    }
    return { threadId, tab: "chat" };
  }
  return { threadId: null, tab: "chat" };
}

function buildPathFromUiState(threadId: string | null, tab: "chat" | "debug"): string {
  if (!threadId) {
    return tab === "debug" ? "/debug" : "/";
  }
  if (tab === "debug") {
    return `/threads/${encodeURIComponent(threadId)}/debug`;
  }
  return `/threads/${encodeURIComponent(threadId)}`;
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

/* ── Main App ───────────────────────────────────────────────── */
export function App(): React.JSX.Element {
  const { theme, toggle: toggleTheme } = useTheme();
  const initialUiState = useMemo(() => parseUiStateFromPath(window.location.pathname), []);

  /* State */
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [threads, setThreads] = useState<ThreadsResponse["data"]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialUiState.threadId);
  const [liveState, setLiveState] = useState<LiveStateResponse | null>(null);
  const [readThreadState, setReadThreadState] = useState<ReadThreadResponse | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEventsResponse["events"]>([]);
  const [modes, setModes] = useState<ModesResponse["data"]>([]);
  const [models, setModels] = useState<ModelsResponse["data"]>([]);
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
  const [availableAgents, setAvailableAgents] = useState<AgentKind[]>(["codex"]);
  const [defaultAgent, setDefaultAgent] = useState<AgentKind>("codex");
  const [selectedAgentKind, setSelectedAgentKind] = useState<AgentKind>("codex");

  /* UI state */
  const [activeTab, setActiveTab] = useState<"chat" | "debug">(initialUiState.tab);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [isChatAtBottom, setIsChatAtBottom] = useState(true);
  const [visibleChatItemLimit, setVisibleChatItemLimit] = useState(INITIAL_VISIBLE_CHAT_ITEMS);
  const [suppressEntryAnimations, setSuppressEntryAnimations] = useState(false);
  const [hasHydratedModeFromLiveState, setHasHydratedModeFromLiveState] = useState(false);
  const [isModeSyncing, setIsModeSyncing] = useState(false);
  const [sidebarCollapsedGroups, setSidebarCollapsedGroups] = useState<Record<string, boolean>>(
    () => readSidebarCollapsedGroupsFromStorage()
  );

  /* Refs */
  const selectedThreadIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const coreRefreshIntervalRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const lastAppliedModeSignatureRef = useRef("");
  const pendingMaterializationThreadIdsRef = useRef<Set<string>>(new Set());

  /* Derived */
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );
  const groupedThreads = useMemo(() => {
    type Group = {
      key: string;
      label: string;
      projectPath: string | null;
      latestUpdatedAt: number;
      threads: Thread[];
    };
    const groups = new Map<string, Group>();

    for (const thread of threads) {
      const cwd = typeof thread.cwd === "string" && thread.cwd.trim() ? thread.cwd.trim() : null;
      const path = typeof thread.path === "string" && thread.path.trim() ? thread.path.trim() : null;
      const projectPath = cwd ?? path;
      const key = projectPath ? `project:${projectPath}` : "project:unknown";
      const label = projectPath ? basenameFromPath(projectPath) : "Unknown";
      const updatedAt = typeof thread.updatedAt === "number" ? thread.updatedAt : 0;

      const existing = groups.get(key);
      if (existing) {
        existing.threads.push(thread);
        if (updatedAt > existing.latestUpdatedAt) {
          existing.latestUpdatedAt = updatedAt;
        }
      } else {
        groups.set(key, {
          key,
          label,
          projectPath,
          latestUpdatedAt: updatedAt,
          threads: [thread]
        });
      }
    }

    return Array.from(groups.values()).sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt);
  }, [threads]);
  const conversationState = useMemo(() => {
    const liveConversationState = liveState?.conversationState ?? null;
    const readConversationState = readThreadState?.thread ?? null;
    if (!liveConversationState) return readConversationState;
    if (!readConversationState) return liveConversationState;
    const liveUpdatedAt = getConversationStateUpdatedAt(liveConversationState);
    const readUpdatedAt = getConversationStateUpdatedAt(readConversationState);
    return liveUpdatedAt > readUpdatedAt ? liveConversationState : readConversationState;
  }, [liveState?.conversationState, readThreadState?.thread]);

  const pendingRequests = useMemo(() => {
    if (!conversationState) return [] as PendingRequest[];
    return getPendingUserInputRequests(conversationState);
  }, [conversationState]);

  const activeRequest = useMemo(() => {
    if (!pendingRequests.length) return null;
    if (selectedRequestId === null) return pendingRequests[0];
    return pendingRequests.find((r) => r.id === selectedRequestId) ?? pendingRequests[0];
  }, [pendingRequests, selectedRequestId]);

  const activeThreadAgentKind: AgentKind = useMemo(() => {
    const thread = selectedThread as (Thread & { agentKind?: AgentKind }) | null;
    return thread?.agentKind ?? "codex";
  }, [selectedThread]);
  const isActiveThreadOpenCode = activeThreadAgentKind === "opencode";

  const planModeOption = useMemo(
    () => modes.find((mode) => isPlanModeOption(mode)) ?? null,
    [modes]
  );
  const defaultModeOption = useMemo(
    () => modes.find((mode) => !isPlanModeOption(mode)) ?? modes[0] ?? null,
    [modes]
  );
  const isPlanModeEnabled = planModeOption !== null && selectedModeKey === planModeOption.mode;

  const effortOptions = useMemo(() => {
    const vals = new Set<string>(DEFAULT_EFFORT_OPTIONS);
    for (const m of modes) if (m.reasoning_effort) vals.add(m.reasoning_effort);
    const le = conversationState?.latestReasoningEffort;
    if (le) vals.add(le);
    if (selectedReasoningEffort) vals.add(selectedReasoningEffort);
    return Array.from(vals);
  }, [conversationState?.latestReasoningEffort, modes, selectedReasoningEffort]);
  const effortOptionsWithoutAssumedDefault = useMemo(
    () => effortOptions.filter((option) => option !== ASSUMED_APP_DEFAULT_EFFORT),
    [effortOptions]
  );

  const modelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) {
      const label =
        m.displayName && m.displayName !== m.id
          ? `${m.displayName} (${m.id})`
          : m.displayName || m.id;
      map.set(m.id, label);
    }
    const lm = conversationState?.latestModel;
    if (lm && !map.has(lm)) map.set(lm, lm);
    if (selectedModelId && !map.has(selectedModelId)) map.set(selectedModelId, selectedModelId);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [conversationState?.latestModel, models, selectedModelId]);
  const modelOptionsWithoutAssumedDefault = useMemo(
    () => modelOptions.filter((option) => option.id !== ASSUMED_APP_DEFAULT_MODEL),
    [modelOptions]
  );

  const turns = conversationState?.turns ?? [];
  const conversationItemCount = useMemo(
    () => turns.reduce((count, turn) => count + (turn.items?.length ?? 0), 0),
    [turns]
  );
  const firstVisibleChatItemIndex = Math.max(0, conversationItemCount - visibleChatItemLimit);
  const hasHiddenChatItems = firstVisibleChatItemIndex > 0;
  const visibleTurns = useMemo(() => {
    let globalItemIndex = 0;
    return turns
      .map((turn, ti) => {
        const items = turn.items ?? [];
        const visibleItems: Array<{ item: (typeof items)[number]; itemIndexInTurn: number; globalItemIndex: number }> = [];
        items.forEach((item, itemIndexInTurn) => {
          const itemGlobalIndex = globalItemIndex;
          globalItemIndex += 1;
          if (itemGlobalIndex >= firstVisibleChatItemIndex) {
            visibleItems.push({ item, itemIndexInTurn, globalItemIndex: itemGlobalIndex });
          }
        });
        return { turn, turnIndex: ti, visibleItems };
      })
      .filter((entry) => entry.visibleItems.length > 0);
  }, [firstVisibleChatItemIndex, turns]);
  const lastTurn = turns[turns.length - 1];
  const isGenerating = lastTurn?.status === "in-progress";
  const commitLabel = health?.state.gitCommit ?? "unknown";
  const allSystemsReady =
    health?.state.appReady === true &&
    health?.state.ipcConnected === true &&
    health?.state.ipcInitialized === true;
  const hasAnySystemFailure =
    health?.state.appReady === false ||
    health?.state.ipcConnected === false ||
    health?.state.ipcInitialized === false;
  const allowEntryLayoutAnimations = !suppressEntryAnimations;

  /* Data loading */
  const loadCoreData = useCallback(async () => {
    const [nh, nt, nm, nmo, ntr, nhist, nag] = await Promise.all([
      getHealth(),
      listThreads({ limit: 80, archived: false, all: true, maxPages: 20 }),
      listCollaborationModes(),
      listModels(),
      getTraceStatus(),
      listDebugHistory(120),
      listAgents().catch(() => null)
    ]);
    setHealth(nh);
    setThreads(nt.data);
    setModes(nm.data);
    setModels(nmo.data);
    setTraceStatus(ntr);
    setHistory(nhist.history);
    if (nag) {
      const enabledAgents = nag.agents.filter((a) => a.enabled).map((a) => a.kind);
      if (enabledAgents.length > 0) setAvailableAgents(enabledAgents);
      setDefaultAgent(nag.defaultAgent);
      setSelectedAgentKind((cur) => (enabledAgents.includes(cur) ? cur : nag.defaultAgent));
    }
    setSelectedThreadId((cur) => {
      if (cur) return cur;
      return nt.data[0]?.id ?? null;
    });
    setSelectedModeKey((cur) => {
      if (cur) return cur;
      const nonPlanDefault = nm.data.find((mode) => !isPlanModeOption(mode));
      return nonPlanDefault?.mode ?? nm.data[0]?.mode ?? "";
    });
  }, []);

  const loadSelectedThread = useCallback(async (threadId: string) => {
    const includeTurns = !pendingMaterializationThreadIdsRef.current.has(threadId);
    const [live, stream, read] = await Promise.all([
      getLiveState(threadId),
      getStreamEvents(threadId),
      readThread(threadId, { includeTurns })
    ]);
    if ((live.conversationState?.turns.length ?? 0) > 0 || read.thread.turns.length > 0) {
      pendingMaterializationThreadIdsRef.current.delete(threadId);
    }
    setLiveState(live);
    setReadThreadState(read);
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
    const onPopState = () => {
      const next = parseUiStateFromPath(window.location.pathname);
      setSelectedThreadId(next.threadId);
      setActiveTab(next.tab);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    const nextPath = buildPathFromUiState(selectedThreadId, activeTab);
    if (window.location.pathname === nextPath) return;
    window.history.replaceState(null, "", nextPath);
  }, [activeTab, selectedThreadId]);

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
      setReadThreadState(null);
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
    const cs = conversationState;
    if (!cs) return;
    const remoteSelection = readModeSelectionFromConversationState(cs);
    const remoteModeKey = remoteSelection.modeKey || selectedModeKey || defaultModeOption?.mode || "";
    const remoteSignature = buildModeSignature(
      remoteModeKey,
      remoteSelection.modelId,
      remoteSelection.reasoningEffort
    );

    if (!hasHydratedModeFromLiveState) {
      if (remoteModeKey) setSelectedModeKey(remoteModeKey);
      setSelectedModelId(remoteSelection.modelId);
      setSelectedReasoningEffort(remoteSelection.reasoningEffort);
      lastAppliedModeSignatureRef.current = remoteSignature;
      setHasHydratedModeFromLiveState(true);
      return;
    }

    const localSignature = buildModeSignature(selectedModeKey, selectedModelId, selectedReasoningEffort);
    if (remoteSignature === localSignature) {
      lastAppliedModeSignatureRef.current = remoteSignature;
      if (isModeSyncing) {
        setIsModeSyncing(false);
      }
      return;
    }

    if (remoteSelection.modeKey) {
      setSelectedModeKey(remoteSelection.modeKey);
    } else if (!selectedModeKey && remoteModeKey) {
      setSelectedModeKey(remoteModeKey);
    }
    setSelectedModelId(remoteSelection.modelId);
    setSelectedReasoningEffort(remoteSelection.reasoningEffort);
    lastAppliedModeSignatureRef.current = remoteSignature;
    if (isModeSyncing) {
      setIsModeSyncing(false);
    }
  }, [
    conversationState,
    defaultModeOption?.mode,
    hasHydratedModeFromLiveState,
    isModeSyncing,
    selectedModeKey,
    selectedModelId,
    selectedReasoningEffort
  ]);

  useEffect(() => {
    lastAppliedModeSignatureRef.current = "";
    setHasHydratedModeFromLiveState(false);
    setIsModeSyncing(false);
  }, [selectedThreadId]);

  useEffect(() => {
    writeSidebarCollapsedGroupsToStorage(sidebarCollapsedGroups);
  }, [sidebarCollapsedGroups]);

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

  // Keep bottom pinned when expanded/collapsed blocks change chat height.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current || !chatContentRef.current) return;
    const scroller = scrollRef.current;
    const content = chatContentRef.current;
    const observer = new ResizeObserver(() => {
      if (!isChatAtBottom) return;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [activeTab, isChatAtBottom, selectedThreadId]);

  // New thread selection starts at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setIsChatAtBottom(true);
    setVisibleChatItemLimit(INITIAL_VISIBLE_CHAT_ITEMS);
  }, [activeTab, selectedThreadId]);

  // Prevent sliding animations when switching chats.
  useEffect(() => {
    setSuppressEntryAnimations(true);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!suppressEntryAnimations) return;
    if (!selectedThreadId) {
      setSuppressEntryAnimations(false);
      return;
    }
    if (!conversationState) return;
    const timer = window.setTimeout(() => setSuppressEntryAnimations(false), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [conversationState, selectedThreadId, suppressEntryAnimations]);

  /* Actions */
  const submitMessage = useCallback(async (draft: string) => {
    if (!draft.trim()) return;

    setIsBusy(true);
    try {
      setError("");

      let threadId = selectedThreadId;

      // Auto-create a thread if none is selected.
      if (!threadId) {
        const created = await createThread({
          agentKind: selectedAgentKind
        });
        threadId = created.threadId;
        pendingMaterializationThreadIdsRef.current.add(threadId);
        setSelectedThreadId(threadId);
        selectedThreadIdRef.current = threadId;
      }

      await sendMessage({ threadId, text: draft });
      pendingMaterializationThreadIdsRef.current.delete(threadId);
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [refreshAll, selectedAgentKind, selectedThreadId]);

  const applyModeDraft = useCallback(async (draft: {
    modeKey: string;
    modelId: string;
    reasoningEffort: string;
  }) => {
    if (!selectedThreadId) {
      return;
    }

    const mode = modes.find((entry) => entry.mode === draft.modeKey) ?? null;
    if (!mode) {
      return;
    }

    const signature = buildModeSignature(draft.modeKey, draft.modelId, draft.reasoningEffort);
    if (!isModeSyncing && lastAppliedModeSignatureRef.current === signature) {
      return;
    }

    const previousSignature = lastAppliedModeSignatureRef.current;
    lastAppliedModeSignatureRef.current = signature;
    setIsModeSyncing(true);
    try {
      setError("");
      await setCollaborationMode({
        threadId: selectedThreadId,
        collaborationMode: {
          mode: mode.mode,
          settings: {
            model: draft.modelId || null,
            reasoning_effort: draft.reasoningEffort || null,
            developer_instructions: mode.developer_instructions ?? null
          }
        }
      });
      await loadSelectedThread(selectedThreadId);
    } catch (e) {
      lastAppliedModeSignatureRef.current = previousSignature;
      setError(toErrorMessage(e));
    } finally {
      setIsModeSyncing(false);
    }
  }, [isModeSyncing, loadSelectedThread, modes, selectedThreadId]);

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
      await submitUserInput({
        threadId: selectedThreadId,
        requestId: activeRequest.id,
        response: { answers }
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, answerDraft, refreshAll, selectedThreadId]);

  const skipPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    setIsBusy(true);
    try {
      setError("");
      await submitUserInput({
        threadId: selectedThreadId,
        requestId: activeRequest.id,
        response: { answers: {} }
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, refreshAll, selectedThreadId]);

  const runInterrupt = useCallback(async () => {
    if (!selectedThreadId) return;
    setIsBusy(true);
    try {
      setError("");
      await interruptThread({ threadId: selectedThreadId });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [refreshAll, selectedThreadId]);

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

  const createNewThread = useCallback(async (projectPath: string, agentKind?: AgentKind) => {
    const trimmedProjectPath = projectPath.trim();
    if (!trimmedProjectPath) {
      setError("Cannot create thread: missing project path");
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      const created = await createThread({
        cwd: trimmedProjectPath,
        ...(agentKind ? { agentKind } : {})
      });
      pendingMaterializationThreadIdsRef.current.add(created.threadId);
      setSelectedThreadId(created.threadId);
      selectedThreadIdRef.current = created.threadId;
      setMobileSidebarOpen(false);
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [refreshAll]);

  const renderSidebarContent = (viewport: "desktop" | "mobile"): React.JSX.Element => (
    <>
      <div className="relative z-20 h-14 shrink-0 px-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -bottom-3 bg-gradient-to-b from-sidebar from-58% via-sidebar/88 via-80% to-transparent to-100%"
        />
        <div className="relative z-10 flex items-center justify-between h-full">
          <span className="text-sm font-semibold">Farfield</span>
          <div className="flex items-center gap-1">
            {viewport === "desktop" && (
              <IconBtn onClick={() => setDesktopSidebarOpen(false)} title="Hide sidebar">
                <PanelLeft size={15} />
              </IconBtn>
            )}
            {viewport === "mobile" && (
              <Button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden py-2 pl-2 pr-0">
          {threads.length === 0 && (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">No threads</div>
          )}
          <div className="space-y-2 pr-2">
            {groupedThreads.map((group) => {
              const hasSelectedThread = group.threads.some((thread) => thread.id === selectedThreadId);
              const isCollapsed = hasSelectedThread ? false : Boolean(sidebarCollapsedGroups[group.key]);
              return (
                <div key={group.key} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      onClick={() =>
                        setSidebarCollapsedGroups((prev) => ({
                          ...prev,
                          [group.key]: !isCollapsed
                        }))
                      }
                      variant="ghost"
                      className="h-6 flex-1 justify-start gap-2 rounded-lg px-2 py-1 text-left text-[13px] tracking-tight font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    >
                      {isCollapsed ? (
                        <Folder size={13} className="shrink-0" />
                      ) : (
                        <FolderOpen size={13} className="shrink-0" />
                      )}
                      <span className="min-w-0 truncate">{group.label}</span>
                    </Button>
                    <IconBtn
                      onClick={() => {
                        if (!group.projectPath) {
                          return;
                        }
                        void createNewThread(group.projectPath);
                      }}
                      title={
                        group.projectPath
                          ? `New thread in ${group.label}`
                          : "Cannot create thread: missing project path"
                      }
                      disabled={isBusy || !group.projectPath}
                    >
                      <Plus size={14} />
                    </IconBtn>
                  </div>
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.16, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1 pl-4 pt-0.5">
                          {group.threads.map((thread) => {
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
                                className={`w-full min-w-0 h-auto flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] tracking-tight font-normal transition-colors ${
                                  isSelected
                                    ? "bg-muted/90 text-foreground shadow-sm"
                                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate leading-5">{threadLabel(thread)}</span>
                                {thread.updatedAt && (
                                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                                    {formatDate(thread.updatedAt)}
                                  </span>
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative z-20 shrink-0 p-3">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-3 bottom-0 bg-gradient-to-t from-sidebar from-58% via-sidebar/88 via-80% to-transparent to-100%"
        />
        <div className="relative z-10 flex items-center justify-between gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 transition-colors cursor-default min-w-0">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    allSystemsReady
                      ? "bg-success"
                      : hasAnySystemFailure
                        ? "bg-danger"
                        : "bg-muted-foreground/40"
                  }`}
                />
                <span className="font-mono truncate">commit {commitLabel}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="space-y-1 text-xs">
              <div className="font-mono text-[11px]">commit {commitLabel}</div>
              <div>App: {health?.state.appReady ? "ok" : "not ready"}</div>
              <div>IPC: {health?.state.ipcConnected ? "connected" : "disconnected"}</div>
              <div>Init: {health?.state.ipcInitialized ? "ready" : "not ready"}</div>
              {health?.state.lastError && (
                <div className="max-w-64 break-words text-destructive">
                  Error: {health.state.lastError}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/achimala/farfield"
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <Github size={14} />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top" align="end">GitHub</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </>
  );

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <TooltipProvider delayDuration={120}>
      <div className="app-shell flex bg-background text-foreground font-sans">

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

      {/* Desktop sidebar */}
      <AnimatePresence initial={false}>
        {desktopSidebarOpen && (
          <motion.aside
            key="desktop-sidebar"
            initial={{ x: -280, opacity: 0.94 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0.94 }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.7 }}
            className="hidden md:flex fixed left-0 top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] z-30 w-64 flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
          >
            {renderSidebarContent("desktop")}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Mobile sidebar */}
      <AnimatePresence initial={false}>
        {mobileSidebarOpen && (
          <motion.aside
            key="mobile-sidebar"
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.7 }}
            className="md:hidden fixed left-0 top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] z-50 w-64 flex flex-col border-r border-sidebar-border bg-sidebar shadow-xl"
          >
            {renderSidebarContent("mobile")}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main area ───────────────────────────────────────── */}
      <div
        className={`relative flex-1 flex flex-col min-w-0 transition-[margin] duration-200 ${
          desktopSidebarOpen ? "md:ml-64" : "md:ml-0"
        }`}
      >

        {/* Header */}
        <header
          className={`flex items-center justify-between px-3 h-14 shrink-0 gap-2 ${
            activeTab === "chat"
              ? "absolute inset-x-0 top-0 z-20 bg-transparent"
              : "border-b border-border"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="md:hidden">
              <IconBtn onClick={() => setMobileSidebarOpen(true)} title="Threads">
                <Menu size={15} />
              </IconBtn>
            </div>
            {!desktopSidebarOpen && (
              <div className="hidden md:block">
                <IconBtn onClick={() => setDesktopSidebarOpen(true)} title="Show sidebar">
                  <PanelLeft size={15} />
                </IconBtn>
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate leading-5 flex items-center gap-1.5">
                {selectedThread ? threadLabel(selectedThread) : "No thread selected"}
                {selectedThread && isActiveThreadOpenCode && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium leading-3">
                    OpenCode
                  </span>
                )}
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
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-4 z-10 h-[5.5rem] bg-gradient-to-b from-background from-52% via-background/78 via-82% to-transparent to-100%"
            />

            {/* Conversation */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={selectedThreadId ?? "__no_thread__"}
                  ref={chatContentRef}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  className="max-w-3xl mx-auto px-4 py-8"
                >
                  {turns.length === 0 ? (
                    <div className="text-center py-20 text-sm text-muted-foreground">
                      {selectedThreadId
                        ? "No messages yet"
                        : availableAgents.length > 0
                          ? "Start typing to create a new thread"
                          : "Select a thread from the sidebar"}
                    </div>
                  ) : (
                    <motion.div layout={allowEntryLayoutAnimations} className="space-y-8">
                      {hasHiddenChatItems && (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-full"
                            onClick={() => {
                              setVisibleChatItemLimit((limit) =>
                                Math.min(conversationItemCount, limit + VISIBLE_CHAT_ITEMS_STEP)
                              );
                            }}
                          >
                            Show older messages ({firstVisibleChatItemIndex})
                          </Button>
                        </div>
                      )}
                      {visibleTurns.map(({ turn, turnIndex, visibleItems }) => {
                        const isLastTurn = turnIndex === turns.length - 1;
                        const turnInProgress = isLastTurn && isGenerating;
                        const items = turn.items ?? [];
                        return (
                          <motion.div layout={allowEntryLayoutAnimations} key={turn.turnId ?? turnIndex} className="space-y-5">
                            <AnimatePresence initial={false}>
                            {visibleItems.map(({ item, itemIndexInTurn, globalItemIndex }) => (
                              <motion.div
                                layout={allowEntryLayoutAnimations}
                                key={item.id ?? `${turnIndex}-${itemIndexInTurn}`}
                                initial={suppressEntryAnimations ? false : { opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                              >
                                <ConversationItem
                                  item={item}
                                  isLast={globalItemIndex === conversationItemCount - 1}
                                  turnIsInProgress={turnInProgress}
                                  previousItemType={items[itemIndexInTurn - 1]?.type}
                                  nextItemType={items[itemIndexInTurn + 1]?.type}
                                />
                              </motion.div>
                            ))}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
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
            <div className="relative z-10 -mt-6 px-4 pt-6 pb-4 shrink-0">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-transparent via-background/85 to-background"
              />
              <div className="relative max-w-3xl mx-auto space-y-2">

                {/* Pending user input (Codex only) */}
                <AnimatePresence>
                  {activeRequest && !isActiveThreadOpenCode && (
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

                {/* Composer */}
                <div className="flex flex-col gap-2">
                  <ChatComposer
                    canSend={Boolean(selectedThreadId) || availableAgents.length > 0}
                    isBusy={isBusy}
                    isGenerating={isGenerating}
                    placeholder={
                      selectedThreadId
                        ? (isActiveThreadOpenCode ? "Message OpenCode…" : "Message Codex…")
                        : (availableAgents.includes("opencode") ? "Message OpenCode…" : "Message Codex…")
                    }
                    onInterrupt={runInterrupt}
                    onSend={submitMessage}
                  />

                  {/* Toolbar */}
                  <div className="flex items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap">
                    {availableAgents.length > 1 && (
                      <Select
                        value={selectedAgentKind}
                        onValueChange={(value) => setSelectedAgentKind(value as AgentKind)}
                      >
                        <SelectTrigger className="h-8 w-[100px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0">
                          <SelectValue placeholder="Agent" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {availableAgents.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {kind === "codex" ? "Codex" : "OpenCode"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {!isActiveThreadOpenCode && (
                      <Button
                        type="button"
                        onClick={() => {
                          if (!planModeOption) return;
                          const nextModeKey = isPlanModeEnabled
                            ? (defaultModeOption?.mode ?? selectedModeKey)
                            : planModeOption.mode;
                          if (!nextModeKey) return;
                          setSelectedModeKey(nextModeKey);
                          void applyModeDraft({
                            modeKey: nextModeKey,
                            modelId: selectedModelId,
                            reasoningEffort: selectedReasoningEffort
                          });
                        }}
                        variant="ghost"
                        size="sm"
                        className={`h-8 shrink-0 rounded-full px-2 text-xs ${
                          isPlanModeEnabled
                            ? "bg-blue-500/15 text-blue-600 hover:bg-blue-500/20 dark:text-blue-300"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                        disabled={!selectedThreadId || !planModeOption}
                      >
                        {isPlanModeEnabled ? <CircleDot size={10} /> : <Circle size={10} />}
                        Plan
                      </Button>
                    )}
                    {!isActiveThreadOpenCode && (
                      <Select
                        value={selectedModelId || APP_DEFAULT_VALUE}
                        onValueChange={(value) => {
                          const nextModelId = value === APP_DEFAULT_VALUE ? "" : value;
                          setSelectedModelId(nextModelId);
                          void applyModeDraft({
                            modeKey: selectedModeKey,
                            modelId: nextModelId,
                            reasoningEffort: selectedReasoningEffort
                          });
                        }}
                        disabled={!selectedThreadId || !selectedModeKey}
                      >
                        <SelectTrigger className="h-8 w-[132px] sm:w-[176px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0">
                          <SelectValue placeholder="Model" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value={APP_DEFAULT_VALUE}>{ASSUMED_APP_DEFAULT_MODEL}</SelectItem>
                          {modelOptionsWithoutAssumedDefault.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {!isActiveThreadOpenCode && (
                      <Select
                        value={selectedReasoningEffort || APP_DEFAULT_VALUE}
                        onValueChange={(value) => {
                          const nextReasoningEffort = value === APP_DEFAULT_VALUE ? "" : value;
                          setSelectedReasoningEffort(nextReasoningEffort);
                          void applyModeDraft({
                            modeKey: selectedModeKey,
                            modelId: selectedModelId,
                            reasoningEffort: nextReasoningEffort
                          });
                        }}
                        disabled={!selectedThreadId || !selectedModeKey}
                      >
                        <SelectTrigger className="h-8 w-[104px] sm:w-[148px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0">
                          <SelectValue placeholder="Effort" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value={APP_DEFAULT_VALUE}>{ASSUMED_APP_DEFAULT_EFFORT}</SelectItem>
                          {effortOptionsWithoutAssumedDefault.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {!isActiveThreadOpenCode && (
                      <span
                        className={`inline-flex w-3 items-center justify-center text-xs text-muted-foreground transition-opacity ${
                          isModeSyncing ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        <Loader2 size={10} className={isModeSyncing ? "animate-spin" : ""} />
                      </span>
                    )}
                    {pendingRequests.length > 0 && (
                      <span className="shrink-0 text-xs text-amber-500 dark:text-amber-400">
                        {pendingRequests.length} pending
                      </span>
                    )}
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
                    className="h-7 text-base md:text-xs"
                  />
                  <Input
                    value={traceNote}
                    onChange={(e) => setTraceNote(e.target.value)}
                    placeholder="marker note"
                    className="h-7 text-base md:text-xs"
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
    </TooltipProvider>
  );
}
