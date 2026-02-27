import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Sun,
  X,
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
  sendMessage,
  setCollaborationMode,
  startTrace,
  stopTrace,
  submitUserInput,
  ApiRequestError,
  type AgentId,
} from "@/lib/api";
import {
  UnifiedEventSchema,
  type UnifiedFeatureAvailability,
  type UnifiedFeatureId,
} from "@farfield/unified-surface";
import { useTheme } from "@/hooks/useTheme";
import { ConversationItem } from "@/components/ConversationItem";
import { ChatComposer } from "@/components/ChatComposer";
import { PendingRequestCard } from "@/components/PendingRequestCard";
import { StreamEventCard } from "@/components/StreamEventCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ── Types ─────────────────────────────────────────────────── */
type Health = Awaited<ReturnType<typeof getHealth>>;
type ThreadsResponse = Awaited<ReturnType<typeof listThreads>>;
type ModesResponse = Awaited<ReturnType<typeof listCollaborationModes>>;
type ModelsResponse = Awaited<ReturnType<typeof listModels>>;
type LiveStateResponse = Awaited<ReturnType<typeof getLiveState>>;
type StreamEventsResponse = Awaited<ReturnType<typeof getStreamEvents>>;
type ReadThreadResponse = Awaited<ReturnType<typeof readThread>>;
type AgentsResponse = Awaited<ReturnType<typeof listAgents>>;
type TraceStatus = Awaited<ReturnType<typeof getTraceStatus>>;
type HistoryResponse = Awaited<ReturnType<typeof listDebugHistory>>;
type HistoryDetail = Awaited<ReturnType<typeof getHistoryEntry>>;
type PendingRequest = ReturnType<typeof getPendingUserInputRequests>[number];
type PendingRequestId = PendingRequest["id"];
type Thread = ThreadsResponse["data"][number];
type ThreadListProviderErrors = ThreadsResponse["errors"];
type AgentDescriptor = AgentsResponse["agents"][number];
type ConversationTurn = NonNullable<
  ReadThreadResponse["thread"]
>["turns"][number];
type ConversationTurnItem = NonNullable<ConversationTurn["items"]>[number];
type ConversationItemType = ConversationTurnItem["type"];

interface FlatConversationItem {
  key: string;
  item: ConversationTurnItem;
  isLast: boolean;
  turnIsInProgress: boolean;
  previousItemType: ConversationItemType | undefined;
  nextItemType: ConversationItemType | undefined;
  spacingTop: number;
}

interface RefreshFlags {
  refreshCore: boolean;
  refreshHistory: boolean;
  refreshSelectedThread: boolean;
}

/* ── Helpers ────────────────────────────────────────────────── */
function formatDate(value: number | string | null | undefined): string {
  if (typeof value === "number")
    return new Date(normalizeUnixTimestampSeconds(value) * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime()))
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return value;
  }
  return "";
}

function threadLabel(thread: Thread): string {
  const title = thread.title?.trim();
  if (title) return title;
  const text = thread.preview.trim();
  if (!text) return `thread ${thread.id.slice(0, 8)}`;
  return text;
}

function threadRecencyTimestamp(thread: Thread): number {
  if (typeof thread.updatedAt === "number") {
    return normalizeUnixTimestampSeconds(thread.updatedAt);
  }
  if (typeof thread.createdAt === "number") {
    return normalizeUnixTimestampSeconds(thread.createdAt);
  }
  return 0;
}

function compareThreadsByRecency(left: Thread, right: Thread): number {
  const recencyDelta =
    threadRecencyTimestamp(right) - threadRecencyTimestamp(left);
  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  const createdDelta =
    normalizeUnixTimestampSeconds(right.createdAt) -
    normalizeUnixTimestampSeconds(left.createdAt);
  if (createdDelta !== 0) {
    return createdDelta;
  }

  return right.id.localeCompare(left.id);
}

function sortThreadsByRecency(threads: Thread[]): Thread[] {
  return [...threads].sort(compareThreadsByRecency);
}

function normalizeUnixTimestampSeconds(value: number): number {
  if (value >= 10_000_000_000) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function buildThreadSignature(thread: Thread): string {
  return [
    thread.id,
    String(thread.updatedAt ?? 0),
    String(thread.createdAt ?? 0),
    thread.title ?? "",
    thread.isGenerating ? "1" : "0",
    thread.preview,
    thread.provider,
    thread.cwd ?? "",
    thread.source ?? "",
  ].join("|");
}

function buildThreadsSignature(threads: Thread[]): string[] {
  return threads.map(buildThreadSignature);
}

function mergeIncomingThreads(
  nextThreads: Thread[],
  previousThreads: Thread[],
): Thread[] {
  const previousById = new Map(
    previousThreads.map((thread) => [thread.id, thread]),
  );
  const merged = nextThreads.map((thread) => {
    const previous = previousById.get(thread.id);
    if (
      (thread.title !== undefined || previous?.title === undefined) &&
      (thread.isGenerating !== undefined ||
        previous?.isGenerating === undefined)
    ) {
      return thread;
    }
    return {
      ...thread,
      ...(thread.title !== undefined || previous?.title === undefined
        ? {}
        : { title: previous.title }),
      ...(thread.isGenerating !== undefined ||
      previous?.isGenerating === undefined
        ? {}
        : { isGenerating: previous.isGenerating }),
    };
  });

  return sortThreadsByRecency(merged);
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const withMessage = err as { message?: string };
    if (typeof withMessage.message === "string") {
      return withMessage.message;
    }
  }
  return String(err);
}

function buildThreadListErrorMessage(
  errors: ThreadListProviderErrors,
): string | null {
  const messages: string[] = [];

  if (errors.codex) {
    messages.push(`Codex: ${errors.codex.message}`);
  }

  if (errors.opencode) {
    messages.push(`OpenCode: ${errors.opencode.message}`);
  }

  if (messages.length === 0) {
    return null;
  }

  return `Thread list sync failed for provider(s): ${messages.join(" | ")}`;
}

function hasSameThreadListErrors(
  left: ThreadListProviderErrors,
  right: ThreadListProviderErrors,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldRenderConversationItem(item: ConversationTurnItem): boolean {
  switch (item.type) {
    case "userMessage":
    case "steeringUserMessage":
      return item.content.some(
        (part) => part.type === "text" && part.text.length > 0,
      );
    case "agentMessage":
      return item.text.length > 0;
    case "reasoning": {
      return (item.summary?.length ?? 0) > 0 || Boolean(item.text);
    }
    case "userInputResponse":
      return Object.values(item.answers).some((answers) => answers.length > 0);
    default:
      return true;
  }
}

function isFeatureAvailable(
  availability: UnifiedFeatureAvailability | undefined,
): boolean {
  return availability?.status === "available";
}

function canUseFeature(
  descriptor: AgentDescriptor | null | undefined,
  featureId: UnifiedFeatureId,
): boolean {
  if (!descriptor) {
    return false;
  }
  return isFeatureAvailable(descriptor.features[featureId]);
}

function isTurnInProgressStatus(status: string | undefined): boolean {
  return status === "in-progress" || status === "inProgress";
}

function isThreadGeneratingState(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined,
): boolean {
  if (!state) {
    return false;
  }
  const lastTurn = state.turns[state.turns.length - 1];
  return isTurnInProgressStatus(lastTurn?.status);
}

function signaturesMatch(prev: string[], next: string[]): boolean {
  if (prev.length !== next.length) {
    return false;
  }
  return prev.every((value, index) => value === next[index]);
}

const DEFAULT_EFFORT_OPTIONS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
const EFFORT_ORDER: ReadonlyArray<string> = DEFAULT_EFFORT_OPTIONS;
const INITIAL_VISIBLE_CHAT_ITEMS = 90;
const VISIBLE_CHAT_ITEMS_STEP = 80;
const APP_DEFAULT_VALUE = "__app_default__";
const ASSUMED_APP_DEFAULT_MODEL = "gpt-5.3-codex";
const ASSUMED_APP_DEFAULT_EFFORT = "medium";
const SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY =
  "farfield.sidebar.collapsed-groups.v1";
const AGENT_FAVICON_BY_ID: Record<AgentId, string> = {
  codex: "https://openai.com/favicon.ico",
  opencode: "https://opencode.ai/favicon.ico",
};

function agentFavicon(agentId: AgentId | null | undefined): string | null {
  if (!agentId) {
    return null;
  }
  return AGENT_FAVICON_BY_ID[agentId] ?? null;
}

function compareEffortOptions(left: string, right: string): number {
  const leftIndex = EFFORT_ORDER.indexOf(left);
  const rightIndex = EFFORT_ORDER.indexOf(right);
  const leftKnown = leftIndex !== -1;
  const rightKnown = rightIndex !== -1;

  if (leftKnown && rightKnown) {
    return leftIndex - rightIndex;
  }
  if (leftKnown) {
    return -1;
  }
  if (rightKnown) {
    return 1;
  }
  return left.localeCompare(right);
}

function sortEffortOptions(options: string[]): string[] {
  return [...options].sort(compareEffortOptions);
}

function AgentFavicon({
  agentId,
  label,
  className,
}: {
  agentId: AgentId;
  label: string;
  className?: string;
}) {
  const faviconUrl = agentFavicon(agentId);
  if (!faviconUrl) {
    return null;
  }

  return (
    <img
      src={faviconUrl}
      alt={label}
      title={label}
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}

function isPlanModeOption(mode: {
  mode?: string | null | undefined;
  name: string;
}): boolean {
  const modeKey = typeof mode.mode === "string" ? mode.mode : "";
  return (
    modeKey.toLowerCase().includes("plan") ||
    mode.name.toLowerCase().includes("plan")
  );
}

function getConversationStateUpdatedAt(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined,
): number {
  if (!state || typeof state.updatedAt !== "number") {
    return Number.NEGATIVE_INFINITY;
  }
  return state.updatedAt;
}

function hasExplicitModeSelectionInState(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined,
): boolean {
  if (!state) {
    return false;
  }

  const mode = state.latestCollaborationMode;
  if (mode) {
    const modeKey = normalizeNullableModeValue(mode.mode);
    const model = normalizeNullableModeValue(mode.settings.model);
    const effort = normalizeNullableModeValue(mode.settings.reasoningEffort);
    if (modeKey.length > 0 || model.length > 0 || effort.length > 0) {
      return true;
    }
  }

  const latestModel = normalizeNullableModeValue(state.latestModel);
  const latestEffort = normalizeNullableModeValue(state.latestReasoningEffort);
  return latestModel.length > 0 || latestEffort.length > 0;
}

function countConversationItems(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined,
): number {
  if (!state) {
    return -1;
  }
  let count = 0;
  for (const turn of state.turns) {
    count += turn.items.length;
  }
  return count;
}

function mergeUserInputRequests(
  liveState: NonNullable<ReadThreadResponse["thread"]>,
  readState: NonNullable<ReadThreadResponse["thread"]>,
): NonNullable<ReadThreadResponse["thread"]>["requests"] {
  type Request = NonNullable<ReadThreadResponse["thread"]>["requests"][number];
  const merged = new Map<string, Request>();

  for (const request of liveState.requests) {
    const key = `${typeof request.id}:${String(request.id)}:${request.method}`;
    merged.set(key, request);
  }

  for (const request of readState.requests) {
    const key = `${typeof request.id}:${String(request.id)}:${request.method}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, request);
      continue;
    }
    if (request.completed === true || existing.completed !== true) {
      merged.set(key, request);
    }
  }

  return Array.from(merged.values());
}

function withMergedRequests(
  baseState: NonNullable<ReadThreadResponse["thread"]>,
  liveState: NonNullable<ReadThreadResponse["thread"]>,
  readState: NonNullable<ReadThreadResponse["thread"]>,
): NonNullable<ReadThreadResponse["thread"]> {
  const mergedRequests = mergeUserInputRequests(liveState, readState);
  if (baseState.requests.length === mergedRequests.length) {
    const allMatch = baseState.requests.every((request, index) => {
      const mergedRequest = mergedRequests[index];
      return mergedRequest !== undefined && mergedRequest === request;
    });
    if (allMatch) {
      return baseState;
    }
  }
  return {
    ...baseState,
    requests: mergedRequests,
  };
}

function pickPreferredConversationState(
  liveState: NonNullable<ReadThreadResponse["thread"]>,
  readState: NonNullable<ReadThreadResponse["thread"]>,
): NonNullable<ReadThreadResponse["thread"]> {
  const liveUpdatedAt = getConversationStateUpdatedAt(liveState);
  const readUpdatedAt = getConversationStateUpdatedAt(readState);

  if (liveUpdatedAt > readUpdatedAt) {
    return withMergedRequests(liveState, liveState, readState);
  }
  if (readUpdatedAt > liveUpdatedAt) {
    return withMergedRequests(readState, liveState, readState);
  }

  const liveHasModeSelection = hasExplicitModeSelectionInState(liveState);
  const readHasModeSelection = hasExplicitModeSelectionInState(readState);
  if (liveHasModeSelection !== readHasModeSelection) {
    return withMergedRequests(
      liveHasModeSelection ? liveState : readState,
      liveState,
      readState,
    );
  }

  if (liveState.turns.length !== readState.turns.length) {
    return withMergedRequests(
      liveState.turns.length > readState.turns.length ? liveState : readState,
      liveState,
      readState,
    );
  }

  const liveItemCount = countConversationItems(liveState);
  const readItemCount = countConversationItems(readState);
  if (liveItemCount !== readItemCount) {
    return withMergedRequests(
      liveItemCount > readItemCount ? liveState : readState,
      liveState,
      readState,
    );
  }

  return withMergedRequests(readState, liveState, readState);
}

function buildModeSignature(
  modeKey: string,
  modelId: string,
  effort: string,
): string {
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
  assumedDefault: string,
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

function readModeSelectionFromConversationState(
  state: NonNullable<ReadThreadResponse["thread"]> | null,
): {
  modeKey: string;
  modelId: string;
  reasoningEffort: string;
} {
  if (!state) {
    return {
      modeKey: "",
      modelId: "",
      reasoningEffort: "",
    };
  }

  if (state.latestCollaborationMode) {
    return {
      modeKey: state.latestCollaborationMode.mode,
      modelId: normalizeModeSettingValue(
        state.latestCollaborationMode.settings.model,
        ASSUMED_APP_DEFAULT_MODEL,
      ),
      reasoningEffort: normalizeModeSettingValue(
        state.latestCollaborationMode.settings.reasoningEffort,
        ASSUMED_APP_DEFAULT_EFFORT,
      ),
    };
  }

  return {
    modeKey: "",
    modelId: normalizeModeSettingValue(
      state.latestModel,
      ASSUMED_APP_DEFAULT_MODEL,
    ),
    reasoningEffort: normalizeModeSettingValue(
      state.latestReasoningEffort,
      ASSUMED_APP_DEFAULT_EFFORT,
    ),
  };
}

function modeSelectionSignatureFromConversationState(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined,
): string {
  const selection = readModeSelectionFromConversationState(state ?? null);
  return buildModeSignature(
    selection.modeKey,
    selection.modelId,
    selection.reasoningEffort,
  );
}

function conversationProgressSignature(
  state: NonNullable<ReadThreadResponse["thread"]> | null | undefined,
): string {
  if (!state) {
    return "";
  }

  const lastTurn = state.turns[state.turns.length - 1];
  if (!lastTurn) {
    return "no-turns";
  }

  const lastTurnId = lastTurn.id ?? lastTurn.turnId ?? "";
  const items = lastTurn.items ?? [];
  const lastItem = items[items.length - 1];

  return [
    String(state.turns.length),
    lastTurnId,
    lastTurn.status,
    String(items.length),
    lastItem?.id ?? "",
    lastItem?.type ?? "",
  ].join("|");
}

function buildLiveStateSyncSignature(
  state: LiveStateResponse | null | undefined,
): string {
  if (!state) {
    return "";
  }

  const conversationState = state.conversationState;
  return [
    state.threadId,
    state.ownerClientId ?? "",
    String(getConversationStateUpdatedAt(conversationState)),
    String(conversationState?.turns.length ?? -1),
    modeSelectionSignatureFromConversationState(conversationState),
    conversationProgressSignature(conversationState),
  ].join("|");
}

function buildReadThreadSyncSignature(
  state: ReadThreadResponse | null | undefined,
): string {
  if (!state) {
    return "";
  }

  const conversationState = state.thread;
  return [
    conversationState.id,
    String(getConversationStateUpdatedAt(conversationState)),
    String(conversationState.turns.length),
    modeSelectionSignatureFromConversationState(conversationState),
    conversationProgressSignature(conversationState),
  ].join("|");
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
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const collapsed: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "boolean") {
        collapsed[key] = value;
      }
    }
    return collapsed;
  } catch {
    return {};
  }
}

function writeSidebarCollapsedGroupsToStorage(
  value: Record<string, boolean>,
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const storage = window.localStorage as Partial<Storage> | undefined;
    if (!storage || typeof storage.setItem !== "function") {
      return;
    }
    storage.setItem(
      SIDEBAR_COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    // Ignore storage errors.
  }
}

function parseUiStateFromPath(pathname: string): {
  threadId: string | null;
  tab: "chat" | "debug";
} {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return { threadId: null, tab: "chat" };
  }
  if (segments.length === 1 && segments[0] === "debug") {
    return { threadId: null, tab: "debug" };
  }
  if (
    segments[0] === "threads" &&
    typeof segments[1] === "string" &&
    segments[1].length > 0
  ) {
    const threadId = decodeURIComponent(segments[1]);
    if (segments[2] === "debug") {
      return { threadId, tab: "debug" };
    }
    return { threadId, tab: "chat" };
  }
  return { threadId: null, tab: "chat" };
}

function buildPathFromUiState(
  threadId: string | null,
  tab: "chat" | "debug",
): string {
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
  children,
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
  const initialUiState = useMemo(
    () => parseUiStateFromPath(window.location.pathname),
    [],
  );

  /* State */
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [threads, setThreads] = useState<ThreadsResponse["data"]>([]);
  const [threadListErrors, setThreadListErrors] =
    useState<ThreadListProviderErrors>({
      codex: null,
      opencode: null,
    });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    initialUiState.threadId,
  );
  const [liveState, setLiveState] = useState<LiveStateResponse | null>(null);
  const [readThreadState, setReadThreadState] =
    useState<ReadThreadResponse | null>(null);
  const [streamEvents, setStreamEvents] = useState<
    StreamEventsResponse["events"]
  >([]);
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
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(
    null,
  );
  const [selectedRequestId, setSelectedRequestId] =
    useState<PendingRequestId | null>(null);
  const [answerDraft, setAnswerDraft] = useState<
    Record<string, { option: string; freeform: string }>
  >({});
  const [agentDescriptors, setAgentDescriptors] = useState<AgentDescriptor[]>(
    [],
  );
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("codex");

  /* UI state */
  const [activeTab, setActiveTab] = useState<"chat" | "debug">(
    initialUiState.tab,
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [isChatAtBottom, setIsChatAtBottom] = useState(true);
  const [visibleChatItemLimit, setVisibleChatItemLimit] = useState(
    INITIAL_VISIBLE_CHAT_ITEMS,
  );
  const [hasHydratedModeFromLiveState, setHasHydratedModeFromLiveState] =
    useState(false);
  const [isModeSyncing, setIsModeSyncing] = useState(false);
  const [sidebarCollapsedGroups, setSidebarCollapsedGroups] = useState<
    Record<string, boolean>
  >(() => readSidebarCollapsedGroupsFromStorage());

  /* Refs */
  const selectedThreadIdRef = useRef<string | null>(null);
  const activeTabRef = useRef<"chat" | "debug">(initialUiState.tab);
  const refreshTimerRef = useRef<number | null>(null);
  const pendingRefreshFlagsRef = useRef<RefreshFlags>({
    refreshCore: false,
    refreshHistory: false,
    refreshSelectedThread: false,
  });
  const coreRefreshIntervalRef = useRef<number | null>(null);
  const selectedThreadRefreshIntervalRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatContentRef = useRef<HTMLDivElement>(null);
  const isChatAtBottomRef = useRef(true);
  const lastAppliedModeSignatureRef = useRef("");
  const hasHydratedAgentSelectionRef = useRef(false);
  const threadProviderByIdRef = useRef<Map<string, AgentId>>(new Map());
  const loadSelectedThreadRef = useRef<
    ((threadId: string) => Promise<void>) | null
  >(null);
  const threadsSignatureRef = useRef<string[]>([]);
  const modesSignatureRef = useRef<string[]>([]);
  const modelsSignatureRef = useRef<string[]>([]);

  /* Derived */
  const selectedThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );
  const agentsById = useMemo(() => {
    const map: Partial<Record<AgentId, AgentDescriptor>> = {};
    for (const descriptor of agentDescriptors) {
      map[descriptor.id] = descriptor;
    }
    return map;
  }, [agentDescriptors]);
  const availableAgentIds = useMemo(
    () =>
      agentDescriptors
        .filter((descriptor) => descriptor.enabled)
        .map((descriptor) => descriptor.id),
    [agentDescriptors],
  );
  const selectedAgentDescriptor = useMemo(
    () => agentsById[selectedAgentId] ?? null,
    [agentsById, selectedAgentId],
  );
  const threadListErrorMessage = useMemo(
    () => buildThreadListErrorMessage(threadListErrors),
    [threadListErrors],
  );
  const selectedAgentLabel = selectedAgentDescriptor?.label ?? "Agent";
  const groupedThreads = useMemo(() => {
    type Group = {
      key: string;
      label: string;
      projectPath: string | null;
      latestUpdatedAt: number;
      preferredAgentId: AgentId | null;
      threads: Thread[];
    };
    const groups = new Map<string, Group>();

    for (const thread of threads) {
      const cwd =
        typeof thread.cwd === "string" && thread.cwd.trim()
          ? thread.cwd.trim()
          : null;
      const projectPath = cwd;
      const key = projectPath ? `project:${projectPath}` : "project:unknown";
      const label = projectPath ? basenameFromPath(projectPath) : "Unknown";
      const updatedAt = threadRecencyTimestamp(thread);
      const threadAgentId = thread.provider;

      const existing = groups.get(key);
      if (existing) {
        existing.threads.push(thread);
        if (!existing.preferredAgentId) {
          existing.preferredAgentId = threadAgentId;
        }
        if (updatedAt > existing.latestUpdatedAt) {
          existing.latestUpdatedAt = updatedAt;
        }
      } else {
        groups.set(key, {
          key,
          label,
          projectPath,
          latestUpdatedAt: updatedAt,
          preferredAgentId: threadAgentId,
          threads: [thread],
        });
      }
    }

    for (const descriptor of agentDescriptors) {
      for (const directory of descriptor.projectDirectories) {
        const normalized = directory.trim();
        if (!normalized) {
          continue;
        }
        const key = `project:${normalized}`;
        if (groups.has(key)) {
          continue;
        }
        groups.set(key, {
          key,
          label: basenameFromPath(normalized),
          projectPath: normalized,
          latestUpdatedAt: 0,
          preferredAgentId: descriptor.id,
          threads: [],
        });
      }
    }

    for (const group of groups.values()) {
      group.threads.sort(compareThreadsByRecency);
    }

    return Array.from(groups.values()).sort(
      (left, right) => right.latestUpdatedAt - left.latestUpdatedAt,
    );
  }, [agentDescriptors, threads]);
  const conversationState = useMemo(() => {
    const liveConversationState = liveState?.conversationState ?? null;
    const readConversationState = readThreadState?.thread ?? null;
    if (!liveConversationState) return readConversationState;
    if (!readConversationState) return liveConversationState;
    return pickPreferredConversationState(
      liveConversationState,
      readConversationState,
    );
  }, [liveState?.conversationState, readThreadState?.thread]);

  const pendingRequests = useMemo(() => {
    if (!conversationState) return [] as PendingRequest[];
    return getPendingUserInputRequests(conversationState);
  }, [conversationState]);
  const liveStateReductionError = useMemo(() => {
    const errorState = liveState?.liveStateError;
    if (!errorState || errorState.kind !== "reductionFailed") {
      return null;
    }
    return errorState;
  }, [liveState?.liveStateError]);

  const activeRequest = useMemo(() => {
    if (!pendingRequests.length) return null;
    if (selectedRequestId === null) return pendingRequests[0];
    return (
      pendingRequests.find((r) => r.id === selectedRequestId) ??
      pendingRequests[0]
    );
  }, [pendingRequests, selectedRequestId]);

  const resolvedSelectedThreadProvider = useMemo((): AgentId | null => {
    if (!selectedThreadId) {
      return null;
    }
    if (selectedThread?.provider) {
      return selectedThread.provider;
    }

    const readProvider =
      readThreadState?.thread.id === selectedThreadId
        ? readThreadState.thread.provider
        : null;
    if (readProvider) {
      return readProvider;
    }

    const liveProvider =
      liveState?.threadId === selectedThreadId
        ? liveState.conversationState?.provider ?? null
        : null;
    if (liveProvider) {
      return liveProvider;
    }

    return null;
  }, [
    liveState?.conversationState?.provider,
    liveState?.threadId,
    readThreadState?.thread.id,
    readThreadState?.thread.provider,
    selectedThread?.provider,
    selectedThreadId,
  ]);

  const activeThreadAgentId: AgentId = useMemo(
    () => resolvedSelectedThreadProvider ?? selectedAgentId,
    [resolvedSelectedThreadProvider, selectedAgentId],
  );
  const hasResolvedSelectedThreadProvider =
    !selectedThreadId || resolvedSelectedThreadProvider !== null;
  const activeAgentDescriptor = useMemo(
    () => agentsById[activeThreadAgentId] ?? selectedAgentDescriptor,
    [activeThreadAgentId, agentsById, selectedAgentDescriptor],
  );
  const activeAgentLabel = activeAgentDescriptor?.label ?? selectedAgentLabel;
  const canSetCollaborationMode = canUseFeature(
    activeAgentDescriptor,
    "setCollaborationMode",
  );
  const canListModels = canUseFeature(activeAgentDescriptor, "listModels");
  const canListCollaborationModes = canUseFeature(
    activeAgentDescriptor,
    "listCollaborationModes",
  );
  const canSubmitUserInputForActiveAgent = canUseFeature(
    activeAgentDescriptor,
    "submitUserInput",
  );
  const canSendMessageForActiveAgent = canUseFeature(
    activeAgentDescriptor,
    "sendMessage",
  );
  const canInterruptForActiveAgent = canUseFeature(
    activeAgentDescriptor,
    "interrupt",
  );
  const canCreateThreadForSelectedAgent = canUseFeature(
    selectedAgentDescriptor,
    "createThread",
  );

  const planModeOption = useMemo(
    () => modes.find((mode) => isPlanModeOption(mode)) ?? null,
    [modes],
  );
  const defaultModeOption = useMemo(
    () => modes.find((mode) => !isPlanModeOption(mode)) ?? modes[0] ?? null,
    [modes],
  );
  const isPlanModeEnabled =
    planModeOption !== null && selectedModeKey === planModeOption.mode;

  const effortOptions = useMemo(() => {
    const vals = new Set<string>(DEFAULT_EFFORT_OPTIONS);
    for (const m of modes) {
      if (m.reasoningEffort) {
        vals.add(m.reasoningEffort);
      }
    }
    const le = conversationState?.latestReasoningEffort;
    if (le) vals.add(le);
    if (selectedReasoningEffort) vals.add(selectedReasoningEffort);
    return sortEffortOptions(Array.from(vals));
  }, [
    conversationState?.latestReasoningEffort,
    modes,
    selectedReasoningEffort,
  ]);
  const effortOptionsWithoutAssumedDefault = useMemo(
    () =>
      effortOptions.filter((option) => option !== ASSUMED_APP_DEFAULT_EFFORT),
    [effortOptions],
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
    if (selectedModelId && !map.has(selectedModelId))
      map.set(selectedModelId, selectedModelId);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [conversationState?.latestModel, models, selectedModelId]);
  const modelOptionsWithoutAssumedDefault = useMemo(
    () =>
      modelOptions.filter((option) => option.id !== ASSUMED_APP_DEFAULT_MODEL),
    [modelOptions],
  );

  const deferredConversationState = useDeferredValue(conversationState);
  const turns = deferredConversationState?.turns ?? [];
  const lastTurn = turns[turns.length - 1];
  const isGenerating = isTurnInProgressStatus(lastTurn?.status);
  const canUseComposer = isGenerating
    ? canInterruptForActiveAgent
    : selectedThreadId
      ? hasResolvedSelectedThreadProvider && canSendMessageForActiveAgent
      : availableAgentIds.length > 0 &&
        canCreateThreadForSelectedAgent &&
        canSendMessageForActiveAgent;
  const flatConversationItems = useMemo(() => {
    const flattened: FlatConversationItem[] = [];
    let previousRenderedTurnIndex = -1;

    turns.forEach((turn, turnIndex) => {
      const items = turn.items ?? [];
      const isLastTurn = turnIndex === turns.length - 1;
      const turnInProgress = isLastTurn && isGenerating;

      items.forEach((item, itemIndexInTurn) => {
        if (!shouldRenderConversationItem(item)) {
          return;
        }
        const isFirstRenderedItem = flattened.length === 0;
        const startsNewTurn = previousRenderedTurnIndex !== turnIndex;
        const spacingTop = isFirstRenderedItem ? 0 : startsNewTurn ? 16 : 10;
        flattened.push({
          key: item.id ?? `${turnIndex}-${itemIndexInTurn}`,
          item,
          isLast: false,
          turnIsInProgress: turnInProgress,
          previousItemType: items[itemIndexInTurn - 1]?.type,
          nextItemType: items[itemIndexInTurn + 1]?.type,
          spacingTop,
        });
        previousRenderedTurnIndex = turnIndex;
      });
    });

    if (flattened.length > 0) {
      flattened[flattened.length - 1]!.isLast = true;
    }

    return flattened;
  }, [isGenerating, turns]);
  const conversationItemCount = flatConversationItems.length;
  const firstVisibleChatItemIndex = Math.max(
    0,
    conversationItemCount - visibleChatItemLimit,
  );
  const hasHiddenChatItems = firstVisibleChatItemIndex > 0;
  const visibleConversationItems = useMemo(
    () => flatConversationItems.slice(firstVisibleChatItemIndex),
    [flatConversationItems, firstVisibleChatItemIndex],
  );
  const commitLabel = health?.state.gitCommit ?? "unknown";
  const codexConfigured = agentsById.codex?.enabled === true;
  const openCodeConnected = agentsById.opencode?.connected === true;
  const allSystemsReady = codexConfigured
    ? health?.state.appReady === true &&
      health?.state.ipcConnected === true &&
      health?.state.ipcInitialized === true
    : openCodeConnected;
  const hasAnySystemFailure = codexConfigured
    ? health?.state.appReady === false ||
      health?.state.ipcConnected === false ||
      health?.state.ipcInitialized === false
    : !openCodeConnected;
  /* Data loading */
  const loadCoreData = useCallback(async () => {
    const shouldLoadDebugData = activeTabRef.current === "debug";
    const [nh, nt, nag, ntr, nhist] = await Promise.all([
      getHealth(),
      listThreads({ limit: 80, archived: false, all: false, maxPages: 1 }),
      listAgents(),
      shouldLoadDebugData
        ? getTraceStatus()
        : Promise.resolve<TraceStatus | null>(null),
      shouldLoadDebugData
        ? listDebugHistory(120)
        : Promise.resolve<HistoryResponse | null>(null),
    ]);
    const incomingThreads = sortThreadsByRecency(nt.data);
    const nextThreadProviders = new Map(threadProviderByIdRef.current);
    for (const thread of incomingThreads) {
      nextThreadProviders.set(thread.id, thread.provider);
    }
    threadProviderByIdRef.current = nextThreadProviders;

    const enabledAgents = nag.agents
      .filter((agent) => agent.enabled)
      .map((agent) => agent.id);
    const nextDefaultAgent = enabledAgents.includes(nag.defaultAgentId)
      ? nag.defaultAgentId
      : (enabledAgents[0] ?? nag.defaultAgentId);
    const threadForActiveProvider =
      incomingThreads.find(
        (thread) => thread.id === selectedThreadIdRef.current,
      ) ?? null;
    const activeProviderId =
      threadForActiveProvider?.provider ?? selectedAgentId;
    const activeDescriptor =
      nag.agents.find((agent) => agent.id === activeProviderId) ?? null;

    const [nm, nmo] = await Promise.all([
      canUseFeature(activeDescriptor, "listCollaborationModes")
        ? listCollaborationModes(activeProviderId)
        : Promise.resolve({ data: [] as ModesResponse["data"] }),
      canUseFeature(activeDescriptor, "listModels")
        ? listModels(activeProviderId)
        : Promise.resolve({ data: [] as ModelsResponse["data"] }),
    ]);

    let preferredAgentId: AgentId | null = null;
    const nextModesSignature = nm.data.map((mode) =>
      [mode.mode, mode.name, mode.reasoningEffort ?? ""].join("|"),
    );
    const nextModelsSignature = nmo.data.map((model) =>
      [model.id, model.displayName ?? ""].join("|"),
    );

    startTransition(() => {
      setHealth((prev) => {
        if (
          prev &&
          prev.state.appReady === nh.state.appReady &&
          prev.state.ipcConnected === nh.state.ipcConnected &&
          prev.state.ipcInitialized === nh.state.ipcInitialized &&
          prev.state.gitCommit === nh.state.gitCommit &&
          prev.state.lastError === nh.state.lastError &&
          prev.state.historyCount === nh.state.historyCount &&
          prev.state.threadOwnerCount === nh.state.threadOwnerCount
        ) {
          return prev;
        }
        return nh;
      });
      setThreadListErrors((prev) =>
        hasSameThreadListErrors(prev, nt.errors) ? prev : nt.errors,
      );
      setThreads((previousThreads) => {
        const nextThreads = mergeIncomingThreads(
          incomingThreads,
          previousThreads,
        );
        const nextThreadsSignature = buildThreadsSignature(nextThreads);
        if (
          signaturesMatch(threadsSignatureRef.current, nextThreadsSignature)
        ) {
          return previousThreads;
        }
        threadsSignatureRef.current = nextThreadsSignature;
        return nextThreads;
      });
      if (!signaturesMatch(modesSignatureRef.current, nextModesSignature)) {
        modesSignatureRef.current = nextModesSignature;
        setModes(nm.data);
      }
      if (!signaturesMatch(modelsSignatureRef.current, nextModelsSignature)) {
        modelsSignatureRef.current = nextModelsSignature;
        setModels(nmo.data);
      }
      if (ntr) {
        setTraceStatus((prev) => {
          if (
            prev &&
            prev.active?.id === ntr.active?.id &&
            prev.active?.eventCount === ntr.active?.eventCount &&
            prev.recent.length === ntr.recent.length &&
            prev.recent[0]?.id === ntr.recent[0]?.id &&
            prev.recent[0]?.eventCount === ntr.recent[0]?.eventCount
          ) {
            return prev;
          }
          return ntr;
        });
      }
      if (nhist) {
        setHistory((prev) => {
          if (
            prev.length === nhist.history.length &&
            prev[prev.length - 1]?.id ===
              nhist.history[nhist.history.length - 1]?.id
          ) {
            return prev;
          }
          return nhist.history;
        });
      }
      if (nag) {
        setAgentDescriptors((prev) => {
          if (
            prev.length === nag.agents.length &&
            prev.every((agent, index) => {
              const nextAgent = nag.agents[index];
              if (!nextAgent) {
                return false;
              }
              return (
                agent.id === nextAgent.id &&
                agent.enabled === nextAgent.enabled &&
                agent.connected === nextAgent.connected &&
                agent.capabilities.canListModels ===
                  nextAgent.capabilities.canListModels &&
                agent.capabilities.canListCollaborationModes ===
                  nextAgent.capabilities.canListCollaborationModes &&
                agent.capabilities.canSetCollaborationMode ===
                  nextAgent.capabilities.canSetCollaborationMode &&
                agent.capabilities.canSubmitUserInput ===
                  nextAgent.capabilities.canSubmitUserInput &&
                agent.capabilities.canReadLiveState ===
                  nextAgent.capabilities.canReadLiveState &&
                agent.capabilities.canReadStreamEvents ===
                  nextAgent.capabilities.canReadStreamEvents &&
                agent.capabilities.canListProjectDirectories ===
                  nextAgent.capabilities.canListProjectDirectories
              );
            })
          ) {
            return prev;
          }
          return nag.agents;
        });
        preferredAgentId = nextDefaultAgent;
        setSelectedAgentId((cur) => {
          if (!hasHydratedAgentSelectionRef.current) {
            hasHydratedAgentSelectionRef.current = true;
            return nextDefaultAgent;
          }
          return enabledAgents.includes(cur) ? cur : nextDefaultAgent;
        });
      }
      setSelectedThreadId((cur) => {
        if (cur) return cur;
        if (preferredAgentId) {
          const preferredThread = incomingThreads.find(
            (thread) => thread.provider === preferredAgentId,
          );
          if (preferredThread) {
            return preferredThread.id;
          }
        }
        return incomingThreads[0]?.id ?? null;
      });
      setSelectedModeKey((cur) => {
        if (cur) return cur;
        const nonPlanDefault = nm.data.find((mode) => !isPlanModeOption(mode));
        return nonPlanDefault?.mode ?? nm.data[0]?.mode ?? "";
      });
    });
  }, [selectedAgentId]);

  const loadSelectedThread = useCallback(
    async (threadId: string) => {
      const threadAgentId = threadProviderByIdRef.current.get(threadId);
      if (!threadAgentId) {
        throw new ApiRequestError(
          `Thread ${threadId} has no registered provider`,
          {
            code: "threadProviderMissing",
            details: {
              threadId,
            },
          },
        );
      }
      const read = await readThread(threadId, {
        includeTurns: true,
        provider: threadAgentId,
      });
      threadProviderByIdRef.current.set(threadId, threadAgentId);

      const descriptor = agentsById[threadAgentId];
      const canReadLiveState = canUseFeature(descriptor, "readLiveState");
      const canReadStreamEvents = canUseFeature(descriptor, "readStreamEvents");
      const live = canReadLiveState
        ? await getLiveState(threadId, threadAgentId)
        : {
            ok: true as const,
            threadId,
            ownerClientId: null,
            conversationState: null,
            liveStateError: null,
          };
      const shouldLoadStreamEvents =
        canReadStreamEvents && activeTabRef.current === "debug";
      const shouldUpdateSelectedThread =
        selectedThreadIdRef.current === threadId;
      startTransition(() => {
        setThreads((previousThreads) => {
          const nextIsGenerating = live.conversationState
            ? isThreadGeneratingState(live.conversationState)
            : isThreadGeneratingState(read.thread);
          const nextThreads = previousThreads.map((threadSummary) => {
            if (threadSummary.id !== read.thread.id) {
              return threadSummary;
            }

            const nextUpdatedAt =
              typeof read.thread.updatedAt === "number"
                ? Math.max(threadSummary.updatedAt, read.thread.updatedAt)
                : threadSummary.updatedAt;
            const nextTitle =
              read.thread.title !== undefined
                ? read.thread.title
                : threadSummary.title;
            const hadGenerating = threadSummary.isGenerating ?? false;

            if (
              nextUpdatedAt === threadSummary.updatedAt &&
              nextTitle === threadSummary.title &&
              hadGenerating === nextIsGenerating
            ) {
              return threadSummary;
            }

            return {
              ...threadSummary,
              updatedAt: nextUpdatedAt,
              isGenerating: nextIsGenerating,
              ...(nextTitle !== undefined ? { title: nextTitle } : {}),
            };
          });

          const sortedThreads = sortThreadsByRecency(nextThreads);
          const nextSignature = buildThreadsSignature(sortedThreads);
          if (signaturesMatch(threadsSignatureRef.current, nextSignature)) {
            return previousThreads;
          }
          threadsSignatureRef.current = nextSignature;
          return sortedThreads;
        });
        if (!shouldUpdateSelectedThread) {
          return;
        }
        setLiveState((prev) => {
          if (
            buildLiveStateSyncSignature(prev) ===
            buildLiveStateSyncSignature(live)
          ) {
            return prev;
          }
          return live;
        });
        setReadThreadState((prev) => {
          if (
            buildReadThreadSyncSignature(prev) ===
            buildReadThreadSyncSignature(read)
          ) {
            return prev;
          }
          return read;
        });
      });

      if (!shouldLoadStreamEvents) {
        return;
      }

      const stream = await getStreamEvents(threadId, threadAgentId);
      if (selectedThreadIdRef.current !== threadId) {
        return;
      }
      startTransition(() => {
        setStreamEvents((prev) => {
          const prevLast = prev[prev.length - 1];
          const nextLast = stream.events[stream.events.length - 1];
          const prevLastSignature = prevLast ? JSON.stringify(prevLast) : "";
          const nextLastSignature = nextLast ? JSON.stringify(nextLast) : "";
          if (
            prev.length === stream.events.length &&
            prevLastSignature === nextLastSignature
          ) {
            return prev;
          }
          return stream.events;
        });
      });
    },
    [agentsById],
  );

  const refreshAll = useCallback(async () => {
    try {
      setError("");
      await loadCoreData();
      if (selectedThreadIdRef.current)
        await loadSelectedThread(selectedThreadIdRef.current);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, [loadCoreData, loadSelectedThread]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    const next = new Map(threadProviderByIdRef.current);
    for (const thread of threads) {
      next.set(thread.id, thread.provider);
    }
    threadProviderByIdRef.current = next;
  }, [threads]);

  useEffect(() => {
    loadSelectedThreadRef.current = loadSelectedThread;
  }, [loadSelectedThread]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

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
    const refreshCoreData = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void loadCoreData().catch((e) => setError(toErrorMessage(e)));
    };

    const startCoreRefresh = () => {
      if (coreRefreshIntervalRef.current !== null) {
        return;
      }
      coreRefreshIntervalRef.current = window.setInterval(
        refreshCoreData,
        5000,
      );
    };

    const stopCoreRefresh = () => {
      if (coreRefreshIntervalRef.current === null) {
        return;
      }
      window.clearInterval(coreRefreshIntervalRef.current);
      coreRefreshIntervalRef.current = null;
    };

    startCoreRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopCoreRefresh();
        return;
      }
      startCoreRefresh();
    };
    const onPageHide = () => {
      stopCoreRefresh();
    };
    const onPageShow = () => {
      startCoreRefresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stopCoreRefresh();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loadCoreData]);

  useEffect(() => {
    const stopSelectedThreadRefresh = () => {
      if (selectedThreadRefreshIntervalRef.current === null) {
        return;
      }
      window.clearInterval(selectedThreadRefreshIntervalRef.current);
      selectedThreadRefreshIntervalRef.current = null;
    };

    if (!selectedThreadId) {
      stopSelectedThreadRefresh();
      return;
    }

    const refreshSelectedThreadData = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void loadSelectedThread(selectedThreadId).catch((e) =>
        setError(toErrorMessage(e)),
      );
    };

    const startSelectedThreadRefresh = () => {
      if (selectedThreadRefreshIntervalRef.current !== null) {
        return;
      }
      selectedThreadRefreshIntervalRef.current = window.setInterval(
        refreshSelectedThreadData,
        3000,
      );
    };

    startSelectedThreadRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopSelectedThreadRefresh();
        return;
      }
      startSelectedThreadRefresh();
    };
    const onPageHide = () => {
      stopSelectedThreadRefresh();
    };
    const onPageShow = () => {
      startSelectedThreadRefresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      stopSelectedThreadRefresh();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loadSelectedThread, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) {
      setLiveState(null);
      setReadThreadState(null);
      setStreamEvents([]);
      return;
    }
    setLiveState(null);
    setReadThreadState(null);
    setStreamEvents([]);
    const load = loadSelectedThreadRef.current;
    if (!load) {
      return;
    }
    void load(selectedThreadId).catch((e) => setError(toErrorMessage(e)));
  }, [selectedThreadId]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectDelayMs = 1000;
    let hasOpenedConnection = false;

    const scheduleRefresh = (
      refreshCore: boolean,
      refreshHistory: boolean,
      refreshSelectedThread: boolean,
    ) => {
      const previousFlags = pendingRefreshFlagsRef.current;
      pendingRefreshFlagsRef.current = {
        refreshCore: previousFlags.refreshCore || refreshCore,
        refreshHistory: previousFlags.refreshHistory || refreshHistory,
        refreshSelectedThread:
          previousFlags.refreshSelectedThread || refreshSelectedThread,
      };

      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        const flags = pendingRefreshFlagsRef.current;
        pendingRefreshFlagsRef.current = {
          refreshCore: false,
          refreshHistory: false,
          refreshSelectedThread: false,
        };
        void (async () => {
          try {
            if (flags.refreshCore) {
              await loadCoreData();
            } else if (
              flags.refreshHistory &&
              activeTabRef.current === "debug"
            ) {
              const nextHistory = await listDebugHistory(120);
              startTransition(() => {
                setHistory((prev) => {
                  if (
                    prev.length === nextHistory.history.length &&
                    prev[prev.length - 1]?.id ===
                      nextHistory.history[nextHistory.history.length - 1]?.id
                  ) {
                    return prev;
                  }
                  return nextHistory.history;
                });
              });
            }
            if (flags.refreshSelectedThread && selectedThreadIdRef.current) {
              await loadSelectedThread(selectedThreadIdRef.current);
            }
          } catch (e) {
            setError(toErrorMessage(e));
          }
        })();
      }, 200);
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectEvents();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
    };

    const connectEvents = () => {
      if (disposed || source) {
        return;
      }

      source = new EventSource("/api/unified/events");
      source.onopen = () => {
        reconnectDelayMs = 1000;
        if (hasOpenedConnection) {
          return;
        }
        hasOpenedConnection = true;
        scheduleRefresh(
          true,
          activeTabRef.current === "debug",
          Boolean(selectedThreadIdRef.current),
        );
      };

      source.onmessage = (event: MessageEvent<string>) => {
        let refreshCore = false;
        const refreshHistory = false;
        let refreshSelectedThread = false;

        try {
          const parsedEventResult = UnifiedEventSchema.safeParse(
            JSON.parse(event.data),
          );
          if (!parsedEventResult.success) {
            refreshCore = true;
          } else {
            const parsedEvent = parsedEventResult.data;
            if (parsedEvent.kind === "providerStateChanged") {
              refreshCore = true;
            } else if (parsedEvent.kind === "threadUpdated") {
              refreshCore = true;
              if (
                selectedThreadIdRef.current &&
                parsedEvent.threadId === selectedThreadIdRef.current
              ) {
                refreshSelectedThread = true;
              }
            } else if (
              parsedEvent.kind === "userInputRequested" ||
              parsedEvent.kind === "userInputResolved"
            ) {
              if (
                selectedThreadIdRef.current &&
                parsedEvent.threadId === selectedThreadIdRef.current
              ) {
                refreshCore = true;
                refreshSelectedThread = true;
              }
            } else if (parsedEvent.kind === "error") {
              refreshCore = true;
            }
          }
        } catch {
          refreshCore = true;
        }

        scheduleRefresh(refreshCore, refreshHistory, refreshSelectedThread);
      };

      source.onerror = () => {
        if (source) {
          source.close();
          source = null;
        }
        scheduleReconnect();
      };
    };

    const closeEvents = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      pendingRefreshFlagsRef.current = {
        refreshCore: false,
        refreshHistory: false,
        refreshSelectedThread: false,
      };
      if (source) {
        source.close();
        source = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        connectEvents();
        return;
      }
      closeEvents();
    };
    const onPageHide = () => {
      closeEvents();
    };
    const onPageShow = () => {
      connectEvents();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    connectEvents();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      closeEvents();
    };
  }, [loadCoreData, loadSelectedThread]);

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
    const remoteHasExplicitSelection =
      remoteSelection.modeKey.length > 0 ||
      remoteSelection.modelId.length > 0 ||
      remoteSelection.reasoningEffort.length > 0;
    const remoteModeKey =
      remoteSelection.modeKey ||
      selectedModeKey ||
      defaultModeOption?.mode ||
      "";
    const remoteSignature = buildModeSignature(
      remoteModeKey,
      remoteSelection.modelId,
      remoteSelection.reasoningEffort,
    );

    if (!hasHydratedModeFromLiveState) {
      if (remoteModeKey) setSelectedModeKey(remoteModeKey);
      setSelectedModelId(remoteSelection.modelId);
      setSelectedReasoningEffort(remoteSelection.reasoningEffort);
      lastAppliedModeSignatureRef.current = remoteSignature;
      setHasHydratedModeFromLiveState(true);
      return;
    }

    if (!remoteHasExplicitSelection) {
      if (!selectedModeKey && remoteModeKey) {
        setSelectedModeKey(remoteModeKey);
      }
      return;
    }

    const localSignature = buildModeSignature(
      selectedModeKey,
      selectedModelId,
      selectedReasoningEffort,
    );
    if (remoteSignature === localSignature) {
      lastAppliedModeSignatureRef.current = remoteSignature;
      if (isModeSyncing) {
        setIsModeSyncing(false);
      }
      return;
    }

    if (
      isModeSyncing &&
      localSignature === lastAppliedModeSignatureRef.current &&
      remoteSignature !== lastAppliedModeSignatureRef.current
    ) {
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
    selectedReasoningEffort,
  ]);

  useEffect(() => {
    lastAppliedModeSignatureRef.current = "";
    setHasHydratedModeFromLiveState(false);
    setIsModeSyncing(false);
  }, [selectedThreadId]);

  useEffect(() => {
    writeSidebarCollapsedGroupsToStorage(sidebarCollapsedGroups);
  }, [sidebarCollapsedGroups]);

  useEffect(() => {
    isChatAtBottomRef.current = isChatAtBottom;
  }, [isChatAtBottom]);

  // Track whether chat view is at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) {
      return;
    }

    const scroller = scrollRef.current;
    let rafId: number | null = null;

    const syncBottomState = () => {
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      const nextIsBottom = distanceFromBottom <= 48;
      if (nextIsBottom !== isChatAtBottomRef.current) {
        isChatAtBottomRef.current = nextIsBottom;
        setIsChatAtBottom(nextIsBottom);
      }
      rafId = null;
    };

    const handleScroll = () => {
      if (rafId !== null) {
        return;
      }
      rafId = window.requestAnimationFrame(syncBottomState);
    };

    syncBottomState();
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [activeTab, selectedThreadId]);

  // Keep chat pinned to bottom only if user is already at the bottom.
  useEffect(() => {
    if (
      activeTab === "chat" &&
      isChatAtBottomRef.current &&
      scrollRef.current
    ) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTab, conversationItemCount]);

  // Keep bottom pinned when expanded/collapsed blocks change chat height.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current || !chatContentRef.current)
      return;
    const scroller = scrollRef.current;
    const content = chatContentRef.current;
    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (!isChatAtBottomRef.current) {
        return;
      }
      if (rafId !== null) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
        rafId = null;
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [activeTab, selectedThreadId]);

  // New thread selection starts at the bottom.
  useEffect(() => {
    if (activeTab !== "chat" || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    isChatAtBottomRef.current = true;
    setIsChatAtBottom(true);
    setVisibleChatItemLimit(INITIAL_VISIBLE_CHAT_ITEMS);
  }, [activeTab, selectedThreadId]);

  /* Actions */
  const submitMessage = useCallback(
    async (draft: string) => {
      if (!draft.trim()) return;
      if (!canSendMessageForActiveAgent) return;
      if (selectedThreadId && !hasResolvedSelectedThreadProvider) {
        setError("Thread provider is still loading");
        return;
      }

      setIsBusy(true);
      try {
        setError("");

        let threadId = selectedThreadId;
        let threadAgentId = activeThreadAgentId;

        // Auto-create a thread if none is selected.
        if (!threadId) {
          const created = await createThread({
            agentId: selectedAgentId,
          });
          threadId = created.threadId;
          threadAgentId = selectedAgentId;
          threadProviderByIdRef.current.set(threadId, threadAgentId);
          setSelectedThreadId(threadId);
          selectedThreadIdRef.current = threadId;
        }

        await sendMessage({ provider: threadAgentId, threadId, text: draft });
        await refreshAll();
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setIsBusy(false);
      }
    },
    [
      activeThreadAgentId,
      canSendMessageForActiveAgent,
      hasResolvedSelectedThreadProvider,
      refreshAll,
      selectedAgentId,
      selectedThreadId,
    ],
  );

  const applyModeDraft = useCallback(
    async (draft: {
      modeKey: string;
      modelId: string;
      reasoningEffort: string;
    }) => {
      if (!selectedThreadId) {
        return;
      }
      if (!hasResolvedSelectedThreadProvider) {
        setError("Thread provider is still loading");
        return;
      }

      const mode = modes.find((entry) => entry.mode === draft.modeKey) ?? null;
      if (!mode || typeof mode.mode !== "string") {
        return;
      }

      const signature = buildModeSignature(
        draft.modeKey,
        draft.modelId,
        draft.reasoningEffort,
      );
      if (!isModeSyncing && lastAppliedModeSignatureRef.current === signature) {
        return;
      }

      const previousSignature = lastAppliedModeSignatureRef.current;
      lastAppliedModeSignatureRef.current = signature;
      setIsModeSyncing(true);
      try {
        setError("");
        await setCollaborationMode({
          provider: activeThreadAgentId,
          threadId: selectedThreadId,
          collaborationMode: {
            mode: mode.mode,
            settings: {
              model: draft.modelId || null,
              reasoningEffort: draft.reasoningEffort || null,
              developerInstructions: mode.developerInstructions ?? null,
            },
          },
        });
        await loadSelectedThread(selectedThreadId);
      } catch (e) {
        lastAppliedModeSignatureRef.current = previousSignature;
        setError(toErrorMessage(e));
      } finally {
        setIsModeSyncing(false);
      }
    },
    [
      activeThreadAgentId,
      hasResolvedSelectedThreadProvider,
      isModeSyncing,
      loadSelectedThread,
      modes,
      selectedThreadId,
    ],
  );

  const submitPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    if (!hasResolvedSelectedThreadProvider) {
      setError("Thread provider is still loading");
      return;
    }
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
        provider: activeThreadAgentId,
        threadId: selectedThreadId,
        requestId: activeRequest.id,
        response: { answers },
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [
    activeRequest,
    activeThreadAgentId,
    answerDraft,
    hasResolvedSelectedThreadProvider,
    refreshAll,
    selectedThreadId,
  ]);

  const skipPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) return;
    if (!hasResolvedSelectedThreadProvider) {
      setError("Thread provider is still loading");
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      await submitUserInput({
        provider: activeThreadAgentId,
        threadId: selectedThreadId,
        requestId: activeRequest.id,
        response: { answers: {} },
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [
    activeRequest,
    activeThreadAgentId,
    hasResolvedSelectedThreadProvider,
    refreshAll,
    selectedThreadId,
  ]);

  const runInterrupt = useCallback(async () => {
    if (!selectedThreadId || !canInterruptForActiveAgent) return;
    if (!hasResolvedSelectedThreadProvider) {
      setError("Thread provider is still loading");
      return;
    }
    setIsBusy(true);
    try {
      setError("");
      await interruptThread({
        provider: activeThreadAgentId,
        threadId: selectedThreadId,
      });
      await refreshAll();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }, [
    activeThreadAgentId,
    canInterruptForActiveAgent,
    hasResolvedSelectedThreadProvider,
    refreshAll,
    selectedThreadId,
  ]);

  const loadHistoryDetail = useCallback(async (id: string) => {
    if (!id) {
      setHistoryDetail(null);
      return;
    }
    const detail = await getHistoryEntry(id);
    setHistoryDetail(detail);
  }, []);

  useEffect(() => {
    void loadHistoryDetail(selectedHistoryId).catch((e) =>
      setError(toErrorMessage(e)),
    );
  }, [loadHistoryDetail, selectedHistoryId]);

  const handleAnswerChange = useCallback(
    (questionId: string, field: "option" | "freeform", value: string) => {
      setAnswerDraft((prev) => ({
        ...prev,
        [questionId]: {
          ...(prev[questionId] ?? { option: "", freeform: "" }),
          [field]: value,
        },
      }));
    },
    [],
  );

  const createNewThread = useCallback(
    async (projectPath: string, agentId?: AgentId) => {
      const trimmedProjectPath = projectPath.trim();
      const targetAgentId = agentId ?? selectedAgentId;
      if (!trimmedProjectPath) {
        setError("Cannot create thread: missing project path");
        return;
      }
      if (!canUseFeature(agentsById[targetAgentId], "createThread")) {
        setError(
          `Cannot create thread: ${targetAgentId} does not support thread creation`,
        );
        return;
      }
      setIsBusy(true);
      try {
        setError("");
        const created = await createThread({
          cwd: trimmedProjectPath,
          agentId: targetAgentId,
        });
        threadProviderByIdRef.current.set(created.threadId, targetAgentId);
        setSelectedThreadId(created.threadId);
        selectedThreadIdRef.current = created.threadId;
        setMobileSidebarOpen(false);
        await refreshAll();
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setIsBusy(false);
      }
    },
    [agentsById, refreshAll, selectedAgentId],
  );

  const createThreadForSingleAgent = useCallback(
    (projectPath: string) => {
      const onlyAgentId = availableAgentIds[0];
      if (!onlyAgentId) {
        setError("Cannot create thread: no enabled agent");
        return;
      }
      void createNewThread(projectPath, onlyAgentId);
    },
    [availableAgentIds, createNewThread],
  );

  const renderSidebarContent = (
    viewport: "desktop" | "mobile",
  ): React.JSX.Element => (
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
              <IconBtn
                onClick={() => setDesktopSidebarOpen(false)}
                title="Hide sidebar"
              >
                <PanelLeft size={15} />
              </IconBtn>
            )}
            {viewport === "mobile" && (
              <IconBtn
                onClick={() => setMobileSidebarOpen(false)}
                title="Close sidebar"
              >
                <X size={14} />
              </IconBtn>
            )}
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden py-2 pl-2 pr-0">
          {threads.length === 0 && (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center space-y-3">
              <div>No threads</div>
              {availableAgentIds.length > 0 &&
                (availableAgentIds.length === 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={isBusy || !canCreateThreadForSelectedAgent}
                    onClick={() => {
                      const defaultProjectPath =
                        selectedAgentDescriptor?.projectDirectories[0] ?? ".";
                      createThreadForSingleAgent(defaultProjectPath);
                    }}
                  >
                    <Plus size={13} className="mr-1.5" />
                    New {selectedAgentLabel} thread
                  </Button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        disabled={
                          isBusy ||
                          !availableAgentIds.some((agentId) =>
                            canUseFeature(agentsById[agentId], "createThread"),
                          )
                        }
                      >
                        <Plus size={13} className="mr-1.5" />
                        New thread
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" sideOffset={6}>
                      {availableAgentIds.map((agentId) => (
                        <DropdownMenuItem
                          key={agentId}
                          disabled={
                            !canUseFeature(agentsById[agentId], "createThread")
                          }
                          onSelect={() => {
                            if (
                              !canUseFeature(
                                agentsById[agentId],
                                "createThread",
                              )
                            ) {
                              return;
                            }
                            const defaultProjectPath =
                              agentsById[agentId]?.projectDirectories[0] ?? ".";
                            void createNewThread(defaultProjectPath, agentId);
                          }}
                        >
                          <span className="shrink-0 h-4 w-4 rounded-sm bg-muted/30 ring-1 ring-border/60 flex items-center justify-center overflow-hidden">
                            <AgentFavicon
                              agentId={agentId}
                              label={agentsById[agentId]?.label ?? "Agent"}
                              className="h-3.5 w-3.5"
                            />
                          </span>
                          New {agentsById[agentId]?.label ?? agentId} thread
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
            </div>
          )}
          <div className="space-y-2 pr-2">
            {groupedThreads.map((group) => {
              const hasSelectedThread = group.threads.some(
                (thread) => thread.id === selectedThreadId,
              );
              const isCollapsed = hasSelectedThread
                ? false
                : Boolean(sidebarCollapsedGroups[group.key]);
              const nextAgentId = group.preferredAgentId ?? selectedAgentId;
              const nextAgentLabel =
                agentsById[nextAgentId]?.label ?? nextAgentId;
              return (
                <div key={group.key} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      onClick={() =>
                        setSidebarCollapsedGroups((prev) => ({
                          ...prev,
                          [group.key]: !isCollapsed,
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
                    {availableAgentIds.length <= 1 ? (
                      <IconBtn
                        onClick={() => {
                          if (!group.projectPath) {
                            return;
                          }
                          createThreadForSingleAgent(group.projectPath);
                        }}
                        title={
                          group.projectPath
                            ? `New ${nextAgentLabel} thread in ${group.label}`
                            : "Cannot create thread: missing project path"
                        }
                        disabled={
                          isBusy ||
                          !group.projectPath ||
                          !canCreateThreadForSelectedAgent
                        }
                      >
                        <Plus size={14} />
                      </IconBtn>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            disabled={
                              isBusy ||
                              !group.projectPath ||
                              !availableAgentIds.some((agentId) =>
                                canUseFeature(
                                  agentsById[agentId],
                                  "createThread",
                                ),
                              )
                            }
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                            title={
                              group.projectPath
                                ? `New thread in ${group.label}`
                                : "Cannot create thread: missing project path"
                            }
                          >
                            <Plus size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={6}>
                          {availableAgentIds.map((agentId) => (
                            <DropdownMenuItem
                              key={agentId}
                              disabled={
                                !canUseFeature(
                                  agentsById[agentId],
                                  "createThread",
                                )
                              }
                              onSelect={() => {
                                if (!group.projectPath) {
                                  return;
                                }
                                if (
                                  !canUseFeature(
                                    agentsById[agentId],
                                    "createThread",
                                  )
                                ) {
                                  return;
                                }
                                void createNewThread(
                                  group.projectPath,
                                  agentId,
                                );
                              }}
                            >
                              <span className="shrink-0 h-4 w-4 rounded-sm bg-muted/30 ring-1 ring-border/60 flex items-center justify-center overflow-hidden">
                                <AgentFavicon
                                  agentId={agentId}
                                  label={agentsById[agentId]?.label ?? "Agent"}
                                  className="h-3.5 w-3.5"
                                />
                              </span>
                              New {agentsById[agentId]?.label ?? agentId} thread
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="space-y-1 pl-4 pt-0.5">
                      {group.threads.length === 0 && (
                        <div className="px-2.5 py-1 text-[11px] text-muted-foreground/70">
                          No threads yet
                        </div>
                      )}
                      {group.threads.map((thread) => {
                        const isSelected = thread.id === selectedThreadId;
                        const threadIsGenerating =
                          Boolean(thread.isGenerating) ||
                          (isSelected && isGenerating);
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
                            <span className="min-w-0 flex-1 flex items-center gap-1.5 truncate leading-5">
                              <span className="shrink-0 h-4 w-4 rounded-sm bg-muted/30 ring-1 ring-border/60 flex items-center justify-center overflow-hidden">
                                <AgentFavicon
                                  agentId={thread.provider}
                                  label={
                                    agentsById[thread.provider]?.label ??
                                    "Agent"
                                  }
                                  className="h-3.5 w-3.5"
                                />
                              </span>
                              <span className="truncate">
                                {threadLabel(thread)}
                              </span>
                            </span>
                            <span className="shrink-0 flex items-center gap-1.5">
                              {threadIsGenerating && (
                                <Loader2
                                  size={11}
                                  className="animate-spin text-muted-foreground/70"
                                />
                              )}
                              {thread.updatedAt && (
                                <span className="text-[10px] text-muted-foreground/50">
                                  {formatDate(thread.updatedAt)}
                                </span>
                              )}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  )}
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
            <TooltipContent
              side="top"
              align="start"
              className="space-y-1 text-xs"
            >
              <div className="font-mono text-[11px]">commit {commitLabel}</div>
              {agentDescriptors
                .filter((descriptor) => descriptor.enabled)
                .map((descriptor) => (
                  <div key={descriptor.id}>
                    {descriptor.label}:{" "}
                    {descriptor.connected ? "connected" : "disconnected"}
                  </div>
                ))}
              {codexConfigured ? (
                <>
                  <div>App: {health?.state.appReady ? "ok" : "not ready"}</div>
                  <div>
                    IPC:{" "}
                    {health?.state.ipcConnected ? "connected" : "disconnected"}
                  </div>
                  <div>
                    Init: {health?.state.ipcInitialized ? "ready" : "not ready"}
                  </div>
                </>
              ) : null}
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
                className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <Github size={14} />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top" align="end">
              GitHub
            </TooltipContent>
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
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 36,
                mass: 0.7,
              }}
              className="hidden md:flex fixed left-0 top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] z-30 w-64 flex-col border-r border-sidebar-border bg-sidebar/78 supports-[backdrop-filter]:bg-sidebar/62 backdrop-blur-xl shadow-xl"
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
              transition={{
                type: "spring",
                stiffness: 380,
                damping: 36,
                mass: 0.7,
              }}
              className="md:hidden fixed left-0 top-[env(safe-area-inset-top)] bottom-[env(safe-area-inset-bottom)] z-50 w-64 flex flex-col border-r border-sidebar-border bg-sidebar/82 supports-[backdrop-filter]:bg-sidebar/68 backdrop-blur-xl shadow-xl"
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
                <IconBtn
                  onClick={() => setMobileSidebarOpen(true)}
                  title="Threads"
                >
                  <Menu size={15} />
                </IconBtn>
              </div>
              {!desktopSidebarOpen && (
                <div className="hidden md:block">
                  <IconBtn
                    onClick={() => setDesktopSidebarOpen(true)}
                    title="Show sidebar"
                  >
                    <PanelLeft size={15} />
                  </IconBtn>
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium truncate leading-5 flex items-center gap-1.5">
                  {selectedThread
                    ? threadLabel(selectedThread)
                    : "No thread selected"}
                  {selectedThread && activeAgentLabel && (
                    <span className="shrink-0 h-5 w-5 rounded-md bg-muted/30 ring-1 ring-border/60 flex items-center justify-center overflow-hidden">
                      <AgentFavicon
                        agentId={activeThreadAgentId}
                        label={activeAgentLabel}
                        className="h-4 w-4"
                      />
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <IconBtn
                onClick={() =>
                  setActiveTab(activeTab === "debug" ? "chat" : "debug")
                }
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

          <div
            className={
              activeTab === "chat"
                ? "flex-1 min-h-0 flex flex-col pt-14"
                : "flex-1 min-h-0 flex flex-col"
            }
          >
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
            <AnimatePresence>
              {threadListErrorMessage && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-sm text-amber-200">
                    {threadListErrorMessage}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {liveStateReductionError && activeTab === "chat" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-sm text-amber-200">
                    Live updates failed for this thread. Showing saved messages
                    only.
                    {liveStateReductionError.eventIndex !== null && (
                      <span className="ml-2 text-xs text-amber-300/90">
                        event {liveStateReductionError.eventIndex}
                      </span>
                    )}
                    {liveStateReductionError.patchIndex !== null && (
                      <span className="ml-1 text-xs text-amber-300/90">
                        patch {liveStateReductionError.patchIndex}
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Chat tab ──────────────────────────────────────── */}
            {activeTab === "chat" && (
              <div className="relative flex-1 flex flex-col min-h-0">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 -top-4 z-10 h-10 bg-gradient-to-b from-background from-20% via-background/60 via-60% to-transparent to-100%"
                />

                {/* Conversation */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto">
                  <AnimatePresence initial={false} mode="wait">
                    <motion.div
                      key={selectedThreadId ?? "__no_thread__"}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.14, ease: "easeOut" }}
                      className="max-w-3xl mx-auto px-4 pt-4 pb-6"
                    >
                      {turns.length === 0 ? (
                        <div className="text-center py-20 text-sm text-muted-foreground">
                          {selectedThreadId
                            ? "No messages yet"
                            : availableAgentIds.length > 0
                              ? "Start typing to create a new thread"
                              : "Select a thread from the sidebar"}
                        </div>
                      ) : (
                        <div ref={chatContentRef} className="space-y-0">
                          {hasHiddenChatItems && (
                            <div className="flex justify-center pb-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-full"
                                onClick={() => {
                                  setVisibleChatItemLimit((limit) =>
                                    Math.min(
                                      conversationItemCount,
                                      limit + VISIBLE_CHAT_ITEMS_STEP,
                                    ),
                                  );
                                }}
                              >
                                Show older messages ({firstVisibleChatItemIndex}
                                )
                              </Button>
                            </div>
                          )}
                          {visibleConversationItems.map((entry) => (
                            <div
                              key={entry.key}
                              style={{ paddingTop: `${entry.spacingTop}px` }}
                            >
                              <ConversationItem
                                item={entry.item}
                                isLast={entry.isLast}
                                turnIsInProgress={entry.turnIsInProgress}
                                previousItemType={entry.previousItemType}
                                nextItemType={entry.nextItemType}
                              />
                            </div>
                          ))}
                        </div>
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
                          scrollRef.current.scrollTop =
                            scrollRef.current.scrollHeight;
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
                <div className="relative z-10 -mt-6 px-4 pt-6 pb-0 shrink-0">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-transparent via-background/85 to-background"
                  />
                  <div className="relative max-w-3xl mx-auto space-y-2">
                    <AnimatePresence mode="wait">
                      {activeRequest &&
                      canSubmitUserInputForActiveAgent &&
                      hasResolvedSelectedThreadProvider ? (
                        <PendingRequestCard
                          key="pending"
                          request={activeRequest}
                          answerDraft={answerDraft}
                          onDraftChange={handleAnswerChange}
                          onSubmit={() => void submitPendingRequest()}
                          onSkip={() => void skipPendingRequest()}
                          isBusy={isBusy}
                        />
                      ) : (
                        <motion.div
                          key="composer"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.15 }}
                          className="flex flex-col gap-2"
                        >
                          <AnimatePresence initial={false}>
                            {isGenerating && (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 4 }}
                                transition={{ duration: 0.15 }}
                                className="px-1 flex items-center gap-1.5 text-xs text-muted-foreground"
                              >
                                <span className="reasoning-shimmer font-medium">
                                  Thinking…
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <ChatComposer
                            canSend={canUseComposer}
                            isBusy={isBusy}
                            isGenerating={isGenerating}
                            placeholder={
                              selectedThreadId
                                ? `Message ${activeAgentLabel}…`
                                : `Message ${selectedAgentLabel}…`
                            }
                            onInterrupt={runInterrupt}
                            onSend={submitMessage}
                          />

                          {/* Toolbar */}
                          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            {canSetCollaborationMode &&
                              canListCollaborationModes && (
                                <Button
                                  type="button"
                                  onClick={() => {
                                    if (!planModeOption) return;
                                    const nextModeKey = isPlanModeEnabled
                                      ? (defaultModeOption?.mode ??
                                        selectedModeKey)
                                      : planModeOption.mode;
                                    if (!nextModeKey) return;
                                    setSelectedModeKey(nextModeKey);
                                    void applyModeDraft({
                                      modeKey: nextModeKey,
                                      modelId: selectedModelId,
                                      reasoningEffort: selectedReasoningEffort,
                                    });
                                  }}
                                  variant="ghost"
                                  size="sm"
                                  className={`h-8 shrink-0 rounded-full px-2 text-xs ${
                                    isPlanModeEnabled
                                      ? "bg-blue-500/15 text-blue-600 hover:bg-blue-500/20 dark:text-blue-300"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                  }`}
                                  disabled={
                                    !selectedThreadId || !planModeOption
                                  }
                                >
                                  {isPlanModeEnabled ? (
                                    <CircleDot size={10} />
                                  ) : (
                                    <Circle size={10} />
                                  )}
                                  Plan
                                </Button>
                              )}
                            {canSetCollaborationMode && canListModels && (
                              <Select
                                value={selectedModelId || APP_DEFAULT_VALUE}
                                onValueChange={(value) => {
                                  const nextModelId =
                                    value === APP_DEFAULT_VALUE ? "" : value;
                                  setSelectedModelId(nextModelId);
                                  void applyModeDraft({
                                    modeKey: selectedModeKey,
                                    modelId: nextModelId,
                                    reasoningEffort: selectedReasoningEffort,
                                  });
                                }}
                                disabled={!selectedThreadId || !selectedModeKey}
                              >
                                <SelectTrigger className="h-8 w-[132px] sm:w-[176px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0">
                                  <SelectValue placeholder="Model" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value={APP_DEFAULT_VALUE}>
                                    {ASSUMED_APP_DEFAULT_MODEL}
                                  </SelectItem>
                                  {modelOptionsWithoutAssumedDefault.map(
                                    (option) => (
                                      <SelectItem
                                        key={option.id}
                                        value={option.id}
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ),
                                  )}
                                </SelectContent>
                              </Select>
                            )}
                            {canSetCollaborationMode &&
                              canListCollaborationModes && (
                                <Select
                                  value={
                                    selectedReasoningEffort || APP_DEFAULT_VALUE
                                  }
                                  onValueChange={(value) => {
                                    const nextReasoningEffort =
                                      value === APP_DEFAULT_VALUE ? "" : value;
                                    setSelectedReasoningEffort(
                                      nextReasoningEffort,
                                    );
                                    void applyModeDraft({
                                      modeKey: selectedModeKey,
                                      modelId: selectedModelId,
                                      reasoningEffort: nextReasoningEffort,
                                    });
                                  }}
                                  disabled={
                                    !selectedThreadId || !selectedModeKey
                                  }
                                >
                                  <SelectTrigger className="h-8 w-[104px] sm:w-[148px] shrink-0 rounded-full border-0 bg-transparent dark:bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-0">
                                    <SelectValue placeholder="Effort" />
                                  </SelectTrigger>
                                  <SelectContent position="popper">
                                    <SelectItem value={APP_DEFAULT_VALUE}>
                                      {ASSUMED_APP_DEFAULT_EFFORT}
                                    </SelectItem>
                                    {effortOptionsWithoutAssumedDefault.map(
                                      (option) => (
                                        <SelectItem key={option} value={option}>
                                          {option}
                                        </SelectItem>
                                      ),
                                    )}
                                  </SelectContent>
                                </Select>
                              )}
                            {canSetCollaborationMode && (
                              <span
                                className={`inline-flex w-3 items-center justify-center text-xs text-muted-foreground transition-opacity ${
                                  isModeSyncing ? "opacity-100" : "opacity-0"
                                }`}
                              >
                                <Loader2
                                  size={10}
                                  className={
                                    isModeSyncing ? "animate-spin" : ""
                                  }
                                />
                              </span>
                            )}
                            {pendingRequests.length > 0 && (
                              <span className="shrink-0 text-xs text-amber-500 dark:text-amber-400">
                                {pendingRequests.length} pending
                              </span>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
                      <span className="text-xs text-muted-foreground/60">
                        {history.length} entries
                      </span>
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
                          <div className="text-xs text-muted-foreground py-4">
                            Select an entry
                          </div>
                        ) : (
                          <>
                            <pre className="font-mono text-[11px] text-muted-foreground leading-5 whitespace-pre-wrap break-words">
                              {JSON.stringify(
                                historyDetail.fullPayload,
                                null,
                                2,
                              )}
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
                        <span className="text-xs font-medium">
                          Stream Events
                        </span>
                        <span className="text-xs text-muted-foreground/60">
                          {streamEvents.length}
                        </span>
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
      </div>
    </TooltipProvider>
  );
}
