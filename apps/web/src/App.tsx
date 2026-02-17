import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bug, CirclePause, Loader2, MessageSquare, RefreshCcw, Send } from "lucide-react";
import {
  getHealth,
  getHistoryEntry,
  getLiveState,
  getPendingUserInputRequests,
  getStreamEvents,
  getTraceStatus,
  interruptThread,
  listCollaborationModes,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Health = Awaited<ReturnType<typeof getHealth>>;
type ThreadsResponse = Awaited<ReturnType<typeof listThreads>>;
type ModesResponse = Awaited<ReturnType<typeof listCollaborationModes>>;
type LiveStateResponse = Awaited<ReturnType<typeof getLiveState>>;
type StreamEventsResponse = Awaited<ReturnType<typeof getStreamEvents>>;
type TraceStatus = Awaited<ReturnType<typeof getTraceStatus>>;
type HistoryResponse = Awaited<ReturnType<typeof listDebugHistory>>;
type HistoryDetail = Awaited<ReturnType<typeof getHistoryEntry>>;

type ConversationState = NonNullable<LiveStateResponse["conversationState"]>;
type PendingRequest = ReturnType<typeof getPendingUserInputRequests>[number];

function formatDate(value: number | string | null | undefined): string {
  if (typeof value === "number") {
    return new Date(value * 1000).toLocaleString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
    return value;
  }

  return "-";
}

function threadLabel(thread: ThreadsResponse["data"][number]): string {
  const text = thread.preview.trim();
  if (!text) {
    return `(thread ${thread.id.slice(0, 8)})`;
  }
  return text.length > 92 ? `${text.slice(0, 92)}…` : text;
}

function getItemRole(item: ConversationState["turns"][number]["items"][number]): string {
  if (item.type === "userMessage") {
    return "You";
  }
  if (item.type === "agentMessage") {
    return "Codex";
  }
  if (item.type === "reasoning") {
    return "Reasoning";
  }
  if (item.type === "plan") {
    return "Plan";
  }
  if (item.type === "userInputResponse") {
    return "User input";
  }
  return item.type;
}

function getItemText(item: ConversationState["turns"][number]["items"][number]): string {
  if (item.type === "userMessage") {
    return item.content.map((part) => part.text).join("\n");
  }
  if (item.type === "agentMessage") {
    return item.text;
  }
  if (item.type === "reasoning") {
    return item.summary?.join("\n") ?? item.text ?? "";
  }
  if (item.type === "plan") {
    return item.text;
  }
  if (item.type === "userInputResponse") {
    return JSON.stringify(item.answers, null, 2);
  }
  return JSON.stringify(item, null, 2);
}

function modeToCollaborationMode(mode: ModesResponse["data"][number]) {
  return {
    mode: mode.mode,
    settings: {
      model: mode.model,
      reasoning_effort: mode.reasoning_effort,
      developer_instructions: mode.developer_instructions
    }
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App(): React.JSX.Element {
  const [error, setError] = useState("");

  const [health, setHealth] = useState<Health | null>(null);
  const [threads, setThreads] = useState<ThreadsResponse["data"]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveStateResponse | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEventsResponse["events"]>([]);
  const [modes, setModes] = useState<ModesResponse["data"]>([]);

  const [messageDraft, setMessageDraft] = useState("");
  const [selectedModeKey, setSelectedModeKey] = useState("");
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

  const selectedThreadIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const coreRefreshIntervalRef = useRef<number | null>(null);

  const pendingRequests = useMemo(() => {
    if (!liveState?.conversationState) {
      return [] as PendingRequest[];
    }
    return getPendingUserInputRequests(liveState.conversationState);
  }, [liveState]);

  const activeRequest = useMemo(() => {
    if (!pendingRequests.length) {
      return null;
    }

    if (selectedRequestId === null) {
      return pendingRequests[0];
    }

    return pendingRequests.find((request) => request.id === selectedRequestId) ?? pendingRequests[0];
  }, [pendingRequests, selectedRequestId]);

  const selectedMode = useMemo(() => {
    return modes.find((mode) => mode.mode === selectedModeKey) ?? null;
  }, [modes, selectedModeKey]);

  const loadCoreData = useCallback(async () => {
    const [nextHealth, nextThreads, nextModes, nextTrace, nextHistory] = await Promise.all([
      getHealth(),
      listThreads({ limit: 80, archived: false, all: true, maxPages: 20 }),
      listCollaborationModes(),
      getTraceStatus(),
      listDebugHistory(120)
    ]);

    setHealth(nextHealth);
    setThreads(nextThreads.data);
    setModes(nextModes.data);
    setTraceStatus(nextTrace);
    setHistory(nextHistory.history);

    setSelectedThreadId((current) => {
      if (current && nextThreads.data.some((thread) => thread.id === current)) {
        return current;
      }

      const firstThread = nextThreads.data[0];
      return firstThread?.id ?? null;
    });

    setSelectedModeKey((current) => {
      if (current) {
        return current;
      }
      const firstMode = nextModes.data[0];
      return firstMode?.mode ?? "";
    });
  }, []);

  const loadSelectedThread = useCallback(async (threadId: string) => {
    const [live, stream] = await Promise.all([
      getLiveState(threadId),
      getStreamEvents(threadId)
    ]);

    setLiveState(live);
    setStreamEvents(stream.events);
  }, []);

  const loadLiveData = useCallback(async () => {
    const [nextHealth, nextHistory] = await Promise.all([
      getHealth(),
      listDebugHistory(120)
    ]);

    setHealth(nextHealth);
    setHistory(nextHistory.history);

    if (selectedThreadIdRef.current) {
      await loadSelectedThread(selectedThreadIdRef.current);
    }
  }, [loadSelectedThread]);

  const refreshAll = useCallback(async () => {
    try {
      setError("");
      await loadCoreData();
      if (selectedThreadIdRef.current) {
        await loadSelectedThread(selectedThreadIdRef.current);
      }
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    }
  }, [loadCoreData, loadSelectedThread]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (coreRefreshIntervalRef.current) {
      window.clearInterval(coreRefreshIntervalRef.current);
      coreRefreshIntervalRef.current = null;
    }

    coreRefreshIntervalRef.current = window.setInterval(() => {
      void loadCoreData().catch((nextError) => {
        setError(toErrorMessage(nextError));
      });
    }, 5000);

    return () => {
      if (coreRefreshIntervalRef.current) {
        window.clearInterval(coreRefreshIntervalRef.current);
        coreRefreshIntervalRef.current = null;
      }
    };
  }, [loadCoreData]);

  useEffect(() => {
    if (!selectedThreadId) {
      setLiveState(null);
      setStreamEvents([]);
      return;
    }

    void loadSelectedThread(selectedThreadId).catch((nextError) => {
      setError(toErrorMessage(nextError));
    });
  }, [loadSelectedThread, selectedThreadId]);

  useEffect(() => {
    const source = new EventSource("/events");

    source.onmessage = () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void loadLiveData().catch((nextError) => {
          setError(toErrorMessage(nextError));
        });
      }, 800);
    };

    source.onerror = () => {
      source.close();
    };

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      source.close();
    };
  }, [loadLiveData]);

  useEffect(() => {
    if (!activeRequest) {
      setSelectedRequestId(null);
      setAnswerDraft({});
      return;
    }

    setSelectedRequestId((current) => current ?? activeRequest.id);
    setAnswerDraft((previous) => {
      const next: Record<string, { option: string; freeform: string }> = {};
      for (const question of activeRequest.params.questions) {
        const current = previous[question.id];
        next[question.id] = {
          option: current?.option ?? "",
          freeform: current?.freeform ?? ""
        };
      }
      return next;
    });
  }, [activeRequest]);

  const submitMessage = useCallback(async () => {
    if (!selectedThreadId || !messageDraft.trim()) {
      return;
    }

    setIsBusy(true);
    try {
      setError("");
      const ownerOptions = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await sendMessage({
        threadId: selectedThreadId,
        ...ownerOptions,
        text: messageDraft
      });
      setMessageDraft("");
      await refreshAll();
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsBusy(false);
    }
  }, [liveState?.ownerClientId, messageDraft, refreshAll, selectedThreadId]);

  const applyMode = useCallback(async () => {
    if (!selectedThreadId || !selectedMode) {
      return;
    }

    setIsBusy(true);
    try {
      setError("");
      const ownerOptions = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await setCollaborationMode({
        threadId: selectedThreadId,
        ...ownerOptions,
        collaborationMode: modeToCollaborationMode(selectedMode)
      });
      await refreshAll();
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsBusy(false);
    }
  }, [liveState?.ownerClientId, refreshAll, selectedMode, selectedThreadId]);

  const submitPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) {
      return;
    }

    const answers: Record<string, { answers: string[] }> = {};

    for (const question of activeRequest.params.questions) {
      const current = answerDraft[question.id] ?? { option: "", freeform: "" };
      const text = current.option || current.freeform.trim();
      if (text) {
        answers[question.id] = { answers: [text] };
      }
    }

    setIsBusy(true);
    try {
      setError("");
      const ownerOptions = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await submitUserInput({
        threadId: selectedThreadId,
        ...ownerOptions,
        requestId: activeRequest.id,
        response: {
          answers
        }
      });
      await refreshAll();
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, answerDraft, liveState?.ownerClientId, refreshAll, selectedThreadId]);

  const skipPendingRequest = useCallback(async () => {
    if (!selectedThreadId || !activeRequest) {
      return;
    }

    setIsBusy(true);
    try {
      setError("");
      const ownerOptions = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await submitUserInput({
        threadId: selectedThreadId,
        ...ownerOptions,
        requestId: activeRequest.id,
        response: {
          answers: {}
        }
      });
      await refreshAll();
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsBusy(false);
    }
  }, [activeRequest, liveState?.ownerClientId, refreshAll, selectedThreadId]);

  const runInterrupt = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    setIsBusy(true);
    try {
      setError("");
      const ownerOptions = liveState?.ownerClientId ? { ownerClientId: liveState.ownerClientId } : {};
      await interruptThread({
        threadId: selectedThreadId,
        ...ownerOptions
      });
      await refreshAll();
    } catch (nextError) {
      setError(toErrorMessage(nextError));
    } finally {
      setIsBusy(false);
    }
  }, [liveState?.ownerClientId, refreshAll, selectedThreadId]);

  const loadHistoryDetail = useCallback(async (entryId: string) => {
    if (!entryId) {
      setHistoryDetail(null);
      return;
    }

    const detail = await getHistoryEntry(entryId);
    setHistoryDetail(detail);
  }, []);

  useEffect(() => {
    void loadHistoryDetail(selectedHistoryId).catch((nextError) => {
      setError(toErrorMessage(nextError));
    });
  }, [loadHistoryDetail, selectedHistoryId]);

  return (
    <div className="h-screen p-4">
      <div className="mx-auto flex h-full max-w-[1500px] gap-4">
        <Card className="w-[320px] shrink-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Threads</CardTitle>
            <CardDescription>{threads.length} total</CardDescription>
          </CardHeader>
          <CardContent className="flex h-[calc(100%-80px)] flex-col gap-3">
            <Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={isBusy}>
              <RefreshCcw className="mr-2 h-3.5 w-3.5" />
              Refresh
            </Button>
            <ScrollArea className="h-full rounded-md border border-border bg-background/70">
              <div className="space-y-1 p-2">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                      selectedThreadId === thread.id
                        ? "border-primary/30 bg-primary/10"
                        : "border-transparent hover:border-border hover:bg-muted"
                    }`}
                  >
                    <div className="font-medium">{threadLabel(thread)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{formatDate(thread.updatedAt)}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={health?.state.appReady ? "success" : "danger"}>
                  app {health?.state.appReady ? "ready" : "down"}
                </Badge>
                <Badge variant={health?.state.ipcConnected ? "success" : "danger"}>
                  ipc {health?.state.ipcConnected ? "connected" : "down"}
                </Badge>
                <Badge variant={health?.state.ipcInitialized ? "success" : "danger"}>
                  init {health?.state.ipcInitialized ? "ok" : "no"}
                </Badge>
                {liveState?.ownerClientId ? <Badge>owner {liveState.ownerClientId.slice(0, 8)}</Badge> : null}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={runInterrupt} disabled={!selectedThreadId || isBusy}>
                  <CirclePause className="mr-2 h-3.5 w-3.5" />
                  Interrupt
                </Button>
              </div>
            </CardContent>
          </Card>

          {error ? (
            <Card className="border-rose-300 bg-rose-50">
              <CardContent className="p-3 text-sm text-rose-700">{error}</CardContent>
            </Card>
          ) : null}

          <Card className="min-h-0 flex-1 overflow-hidden">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle>{selectedThreadId ?? "No thread selected"}</CardTitle>
              <CardDescription>
                {liveState?.conversationState
                  ? `${liveState.conversationState.turns.length} turns`
                  : "Select a thread"}
              </CardDescription>
            </CardHeader>

            <CardContent className="h-[calc(100%-82px)] min-h-0 p-4">
              <Tabs defaultValue="chat" className="flex h-full min-h-0 flex-col">
                <TabsList>
                  <TabsTrigger value="chat">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="debug">
                    <Bug className="mr-2 h-4 w-4" />
                    Debug
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="chat" className="min-h-0 flex-1">
                  <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-3">
                    <ScrollArea className="rounded-md border border-border bg-background/80">
                      <div className="space-y-3 p-3">
                        {(liveState?.conversationState?.turns ?? []).map((turn, turnIndex) => (
                          <div key={`${turn.turnId ?? "turn"}-${turnIndex}`} className="space-y-2">
                            <div className="text-xs text-muted-foreground">
                              Turn {turnIndex + 1} • {turn.status}
                            </div>
                            {turn.items.map((item, itemIndex) => (
                              <div key={item.id ?? `${turnIndex}-${itemIndex}`} className="rounded-md border border-border bg-card p-3">
                                <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                  {getItemRole(item)}
                                </div>
                                <pre className="font-mono text-[12px] leading-5">{getItemText(item)}</pre>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <Card className="border border-border bg-background/80">
                      <CardContent className="grid gap-2 p-3">
                        <Textarea
                          value={messageDraft}
                          onChange={(event) => setMessageDraft(event.target.value)}
                          placeholder="Send a message to this thread"
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            owner: {liveState?.ownerClientId ?? "unknown"}
                          </span>
                          <Button onClick={() => void submitMessage()} disabled={!selectedThreadId || isBusy}>
                            {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Send
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border border-border bg-background/80">
                      <CardHeader className="pb-2">
                        <CardTitle>Plan Mode</CardTitle>
                        <CardDescription>
                          {pendingRequests.length} pending request set{pendingRequests.length === 1 ? "" : "s"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-[220px] flex-1">
                            <div className="mb-1 text-xs text-muted-foreground">Mode</div>
                            <select
                              className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
                              value={selectedModeKey}
                              onChange={(event) => setSelectedModeKey(event.target.value)}
                            >
                              {modes.map((mode) => (
                                <option key={mode.mode} value={mode.mode}>
                                  {mode.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Button variant="outline" onClick={() => void applyMode()} disabled={!selectedThreadId || isBusy || !selectedMode}>
                            Apply mode
                          </Button>
                        </div>

                        {!activeRequest ? (
                          <div className="text-sm text-muted-foreground">No pending user input requests.</div>
                        ) : (
                          <div className="space-y-3">
                            {pendingRequests.length > 1 ? (
                              <select
                                className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
                                value={String(activeRequest.id)}
                                onChange={(event) => setSelectedRequestId(Number(event.target.value))}
                              >
                                {pendingRequests.map((request) => (
                                  <option key={request.id} value={request.id}>
                                    Request {request.id}
                                  </option>
                                ))}
                              </select>
                            ) : null}

                            {activeRequest.params.questions.map((question) => {
                              const current = answerDraft[question.id] ?? { option: "", freeform: "" };

                              return (
                                <div key={question.id} className="rounded-md border border-border bg-card p-3">
                                  <div className="text-xs uppercase text-muted-foreground">{question.header}</div>
                                  <div className="mt-1 text-sm font-medium">{question.question}</div>
                                  <div className="mt-2 space-y-1">
                                    {question.options.map((option) => (
                                      <label key={`${question.id}-${option.label}`} className="flex items-start gap-2 text-sm">
                                        <input
                                          type="radio"
                                          name={`q-${question.id}`}
                                          checked={current.option === option.label}
                                          onChange={() =>
                                            setAnswerDraft((previous) => {
                                              const prior = previous[question.id] ?? {
                                                option: "",
                                                freeform: ""
                                              };
                                              return {
                                                ...previous,
                                                [question.id]: {
                                                  ...prior,
                                                  option: option.label
                                                }
                                              };
                                            })
                                          }
                                        />
                                        <span>
                                          <span className="font-medium">{option.label}</span>
                                          <span className="block text-xs text-muted-foreground">{option.description}</span>
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                  {question.isOther ? (
                                    <Input
                                      className="mt-2"
                                      placeholder="Optional free-form answer"
                                      value={current.freeform}
                                      onChange={(event) =>
                                        setAnswerDraft((previous) => {
                                          const prior = previous[question.id] ?? {
                                            option: "",
                                            freeform: ""
                                          };
                                          return {
                                            ...previous,
                                            [question.id]: {
                                              ...prior,
                                              freeform: event.target.value
                                            }
                                          };
                                        })
                                      }
                                    />
                                  ) : null}
                                </div>
                              );
                            })}

                            <div className="flex gap-2">
                              <Button variant="outline" onClick={() => void skipPendingRequest()} disabled={isBusy}>
                                Skip
                              </Button>
                              <Button onClick={() => void submitPendingRequest()} disabled={isBusy}>
                                Submit answer
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="debug" className="min-h-0 flex-1">
                  <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-3">
                    <Card className="min-h-0 overflow-hidden border border-border bg-background/80">
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2">
                          <Activity className="h-4 w-4" />
                          History + Replay
                        </CardTitle>
                        <CardDescription>{history.length} entries</CardDescription>
                      </CardHeader>
                      <CardContent className="grid h-[calc(100%-76px)] min-h-0 grid-cols-[280px_minmax(0,1fr)] gap-3">
                        <ScrollArea className="rounded-md border border-border">
                          <div className="space-y-1 p-2">
                            {history
                              .slice()
                              .reverse()
                              .map((entry) => (
                                <button
                                  key={entry.id}
                                  type="button"
                                  onClick={() => setSelectedHistoryId(entry.id)}
                                  className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                    selectedHistoryId === entry.id
                                      ? "border-primary/30 bg-primary/10"
                                      : "border-transparent hover:border-border hover:bg-muted"
                                  }`}
                                >
                                  <div className="font-medium">{entry.source} {entry.direction}</div>
                                  <div className="mt-1 text-muted-foreground">{entry.at}</div>
                                </button>
                              ))}
                          </div>
                        </ScrollArea>

                        <div className="space-y-2">
                          {!historyDetail ? (
                            <div className="text-sm text-muted-foreground">Select a history entry.</div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <input
                                    type="checkbox"
                                    checked={waitForReplayResponse}
                                    onChange={(event) => setWaitForReplayResponse(event.target.checked)}
                                  />
                                  wait for response
                                </label>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void replayHistoryEntry({
                                      entryId: historyDetail.entry.id,
                                      waitForResponse: waitForReplayResponse
                                    }).then(refreshAll)
                                  }
                                >
                                  Replay
                                </Button>
                              </div>
                              <ScrollArea className="h-[460px] rounded-md border border-border bg-muted/40 p-2">
                                <pre className="font-mono text-[11px] leading-5">{JSON.stringify(historyDetail.fullPayload, null, 2)}</pre>
                              </ScrollArea>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <div className="space-y-3">
                      <Card className="border border-border bg-background/80">
                        <CardHeader className="pb-2">
                          <CardTitle>Tracing</CardTitle>
                          <CardDescription>
                            {traceStatus?.active ? `active: ${traceStatus.active.id}` : "inactive"}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <Input value={traceLabel} onChange={(event) => setTraceLabel(event.target.value)} placeholder="trace label" />
                          <Input value={traceNote} onChange={(event) => setTraceNote(event.target.value)} placeholder="marker note" />
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => void startTrace(traceLabel).then(refreshAll)}>
                              Start
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void markTrace(traceNote).then(refreshAll)}>
                              Mark
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void stopTrace().then(refreshAll)}>
                              Stop
                            </Button>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border border-border bg-background/80">
                        <CardHeader className="pb-2">
                          <CardTitle>Stream Events</CardTitle>
                          <CardDescription>{streamEvents.length} recent</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[320px] rounded-md border border-border">
                            <div className="space-y-2 p-2 text-xs">
                              {streamEvents
                                .slice()
                                .reverse()
                                .map((event, index) => (
                                  <div key={index} className="rounded border border-border p-2">
                                    <pre className="font-mono text-[11px] leading-5">{JSON.stringify(event, null, 2)}</pre>
                                  </div>
                                ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
