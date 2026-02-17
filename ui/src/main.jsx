import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const THREAD_LIMIT = 80;
const MAX_VISIBLE_TURNS_STEP = 12;
const RAW_LOG_LIMIT = 120;
const STATUS_POLL_MS = 4000;
const THREADS_POLL_MS = 5000;
const TURN_POLL_IDLE_MS = 6000;
const TURN_POLL_ACTIVE_MS = 1400;

function formatEpochSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return "-";
  }
  return new Date(seconds * 1000).toLocaleString();
}

function toErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

function threadLabel(thread) {
  const text = (thread.preview || "").trim();
  if (!text) {
    return `(thread ${String(thread.id || "").slice(0, 8)})`;
  }
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function getItemRole(item) {
  if (!item || typeof item !== "object") {
    return "Unknown";
  }
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
  return item.type || "Unknown";
}

function getItemClass(item) {
  if (!item || typeof item !== "object") {
    return "unknown";
  }
  if (item.type === "userMessage") {
    return "user";
  }
  if (item.type === "agentMessage") {
    return "agent";
  }
  if (item.type === "reasoning") {
    return "reasoning";
  }
  if (item.type === "plan") {
    return "plan";
  }
  return "unknown";
}

function getItemText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (item.type === "userMessage") {
    const parts = Array.isArray(item.content) ? item.content : [];
    return parts
      .filter((part) => part && part.type === "text")
      .map((part) => part.text || "")
      .join("\n");
  }

  if (item.type === "agentMessage") {
    return item.text || "";
  }

  if (item.type === "reasoning") {
    return Array.isArray(item.summary) ? item.summary.join("\n") : item.text || "";
  }

  if (item.type === "plan") {
    return item.text || "";
  }

  return JSON.stringify(item, null, 2);
}

async function apiGet(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function StatusPill({ label, healthy, text }) {
  return (
    <span className={`pill ${healthy ? "good" : "bad"}`}>
      {label}: {text}
    </span>
  );
}

function App() {
  const [state, setState] = useState(null);
  const [threads, setThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [selectedThread, setSelectedThread] = useState(null);
  const [visibleTurns, setVisibleTurns] = useState(MAX_VISIBLE_TURNS_STEP);

  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [composeText, setComposeText] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawLive, setRawLive] = useState(false);
  const [rawEntries, setRawEntries] = useState([]);

  const [rawRequestMethod, setRawRequestMethod] = useState("thread-follower-start-turn");
  const [rawRequestTargetClientId, setRawRequestTargetClientId] = useState("");
  const [rawRequestVersion, setRawRequestVersion] = useState("");
  const [rawRequestParams, setRawRequestParams] = useState("{}");

  const [rawBroadcastMethod, setRawBroadcastMethod] = useState("thread-stream-state-changed");
  const [rawBroadcastVersion, setRawBroadcastVersion] = useState("");
  const [rawBroadcastParams, setRawBroadcastParams] = useState("{}");

  const selectedThreadRequestRef = useRef(0);

  const setError = useCallback((error) => {
    setErrorMessage(toErrorMessage(error));
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage("");
  }, []);

  const loadState = useCallback(async () => {
    const data = await apiGet("/api/state");
    setState(data.state || null);
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const data = await apiGet(`/api/threads?limit=${THREAD_LIMIT}`);
      const nextThreads = Array.isArray(data.data) ? data.data : [];
      setThreads(nextThreads);

      setSelectedThreadId((current) => {
        if (!current && nextThreads.length) {
          return nextThreads[0].id;
        }
        if (current && nextThreads.some((thread) => thread.id === current)) {
          return current;
        }
        if (!nextThreads.length) {
          return null;
        }
        return nextThreads[0].id;
      });
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const loadSelectedThread = useCallback(async (threadId) => {
    if (!threadId) {
      setSelectedThread(null);
      return;
    }

    const requestId = selectedThreadRequestRef.current + 1;
    selectedThreadRequestRef.current = requestId;

    setThreadLoading(true);
    try {
      const data = await apiGet(
        `/api/thread/${encodeURIComponent(threadId)}?includeTurns=true`
      );
      if (requestId !== selectedThreadRequestRef.current) {
        return;
      }
      setSelectedThread(data.thread || null);
    } finally {
      if (requestId === selectedThreadRequestRef.current) {
        setThreadLoading(false);
      }
    }
  }, []);

  const hasActiveTurn = useMemo(() => {
    const turns = Array.isArray(selectedThread?.turns) ? selectedThread.turns : [];
    return turns.some((turn) => turn.status === "inProgress");
  }, [selectedThread]);

  const visibleTurnData = useMemo(() => {
    const turns = Array.isArray(selectedThread?.turns) ? selectedThread.turns : [];
    const clipped = turns.slice(-visibleTurns);
    return {
      allCount: turns.length,
      turns: clipped,
      hasOlder: turns.length > clipped.length
    };
  }, [selectedThread, visibleTurns]);

  useEffect(() => {
    const run = async () => {
      try {
        clearError();
        await loadState();
        await loadThreads();
      } catch (error) {
        setError(error);
      }
    };

    void run();
  }, [clearError, loadState, loadThreads, setError]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadState().catch(() => {
        // Silent background retry.
      });
    }, STATUS_POLL_MS);

    return () => clearInterval(timer);
  }, [loadState]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadThreads().catch(() => {
        // Silent background retry.
      });
    }, THREADS_POLL_MS);

    return () => clearInterval(timer);
  }, [loadThreads]);

  useEffect(() => {
    setVisibleTurns(MAX_VISIBLE_TURNS_STEP);
    if (!selectedThreadId) {
      setSelectedThread(null);
      return;
    }

    loadSelectedThread(selectedThreadId).catch((error) => {
      setError(error);
    });
  }, [loadSelectedThread, selectedThreadId, setError]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    const intervalMs = hasActiveTurn ? TURN_POLL_ACTIVE_MS : TURN_POLL_IDLE_MS;
    const timer = setInterval(() => {
      loadSelectedThread(selectedThreadId).catch(() => {
        // Silent background retry.
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [hasActiveTurn, loadSelectedThread, selectedThreadId]);

  useEffect(() => {
    if (!rawLive) {
      return;
    }

    const source = new EventSource("/events");
    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "history" && Array.isArray(payload.messages)) {
        setRawEntries(payload.messages.slice(-RAW_LOG_LIMIT));
        return;
      }

      if (payload.type !== "message" || !payload.entry) {
        return;
      }

      setRawEntries((current) => {
        const next = [...current, payload.entry];
        if (next.length <= RAW_LOG_LIMIT) {
          return next;
        }
        return next.slice(next.length - RAW_LOG_LIMIT);
      });
    };

    return () => {
      source.close();
    };
  }, [rawLive]);

  const refreshEverything = useCallback(async () => {
    try {
      clearError();
      await Promise.all([loadState(), loadThreads()]);
      if (selectedThreadId) {
        await loadSelectedThread(selectedThreadId);
      }
    } catch (error) {
      setError(error);
    }
  }, [clearError, loadSelectedThread, loadState, loadThreads, selectedThreadId, setError]);

  const startNewThread = useCallback(async () => {
    try {
      clearError();
      const result = await apiPost("/api/thread/start", {});
      const newThreadId = result.thread?.id;
      if (!newThreadId) {
        throw new Error("No thread id returned");
      }

      setSelectedThreadId(newThreadId);
      await loadThreads();
      await loadSelectedThread(newThreadId);
    } catch (error) {
      setError(error);
    }
  }, [clearError, loadSelectedThread, loadThreads, setError]);

  const sendMessage = useCallback(
    async (event) => {
      event.preventDefault();
      const text = composeText.trim();
      if (!text || sending) {
        return;
      }

      setSending(true);
      try {
        clearError();

        let threadId = selectedThreadId;
        if (!threadId) {
          const started = await apiPost("/api/thread/start", {});
          threadId = started.thread?.id;
          if (!threadId) {
            throw new Error("Could not create a thread");
          }
          setSelectedThreadId(threadId);
        }

        await apiPost(`/api/thread/${encodeURIComponent(threadId)}/message`, {
          text
        });

        setComposeText("");
        await Promise.all([loadThreads(), loadSelectedThread(threadId)]);
      } catch (error) {
        setError(error);
      } finally {
        setSending(false);
      }
    },
    [clearError, composeText, loadSelectedThread, loadThreads, selectedThreadId, sending, setError]
  );

  const interruptActiveTurn = useCallback(async () => {
    if (!selectedThreadId) {
      return;
    }

    try {
      clearError();
      await apiPost(`/api/thread/${encodeURIComponent(selectedThreadId)}/interrupt`, {});
      await loadSelectedThread(selectedThreadId);
    } catch (error) {
      setError(error);
    }
  }, [clearError, loadSelectedThread, selectedThreadId, setError]);

  const submitRawRequest = useCallback(
    async (event) => {
      event.preventDefault();
      try {
        clearError();

        let params;
        try {
          params = rawRequestParams.trim() ? JSON.parse(rawRequestParams) : {};
        } catch {
          throw new Error("Raw request params must be valid JSON");
        }

        const version = rawRequestVersion.trim() ? Number(rawRequestVersion.trim()) : null;
        if (version !== null && (!Number.isInteger(version) || version < 0)) {
          throw new Error("Raw request version must be an integer");
        }

        await apiPost("/api/send-request", {
          method: rawRequestMethod.trim(),
          targetClientId: rawRequestTargetClientId.trim(),
          version,
          params
        });
      } catch (error) {
        setError(error);
      }
    },
    [
      clearError,
      rawRequestMethod,
      rawRequestParams,
      rawRequestTargetClientId,
      rawRequestVersion,
      setError
    ]
  );

  const submitRawBroadcast = useCallback(
    async (event) => {
      event.preventDefault();
      try {
        clearError();

        let params;
        try {
          params = rawBroadcastParams.trim() ? JSON.parse(rawBroadcastParams) : {};
        } catch {
          throw new Error("Raw broadcast params must be valid JSON");
        }

        const version = rawBroadcastVersion.trim()
          ? Number(rawBroadcastVersion.trim())
          : null;
        if (version !== null && (!Number.isInteger(version) || version < 0)) {
          throw new Error("Raw broadcast version must be an integer");
        }

        await apiPost("/api/send-broadcast", {
          method: rawBroadcastMethod.trim(),
          version,
          params
        });
      } catch (error) {
        setError(error);
      }
    },
    [clearError, rawBroadcastMethod, rawBroadcastParams, rawBroadcastVersion, setError]
  );

  const appState = state?.app;
  const ipcState = state?.ipc;

  const appHealthy = Boolean(appState?.running && appState?.initialized);
  const ipcHealthy = Boolean(ipcState?.transportConnected && ipcState?.initialized);

  const appStatusText = appHealthy
    ? `ready (pid ${appState?.pid || "?"})`
    : appState?.running
      ? "starting"
      : "disconnected";

  const ipcStatusText = ipcHealthy ? "connected" : "disconnected";

  return (
    <div className="page">
      <header className="topbar panel">
        <div>
          <h1>Codex Companion</h1>
          <p className="sub">Fast thread controls with a lighter front end.</p>
        </div>
        <div className="statusRow">
          <StatusPill label="App server" healthy={appHealthy} text={appStatusText} />
          <StatusPill label="Desktop socket" healthy={ipcHealthy} text={ipcStatusText} />
        </div>
      </header>

      {errorMessage ? (
        <div className="errorBar panel">
          <p>{errorMessage}</p>
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="layout">
        <aside className="panel sidebar">
          <div className="sectionHead">
            <h2>Threads</h2>
            <div className="buttonRow">
              <button type="button" onClick={refreshEverything}>
                Refresh
              </button>
              <button type="button" onClick={startNewThread}>
                New thread
              </button>
            </div>
          </div>

          <div className="threadListWrap">
            {threadsLoading && !threads.length ? (
              <p className="sub">Loading threads...</p>
            ) : null}

            {!threads.length ? (
              <p className="sub">No threads found.</p>
            ) : (
              <ul className="threadList">
                {threads.map((thread) => {
                  const active = thread.id === selectedThreadId;
                  return (
                    <li key={thread.id}>
                      <button
                        type="button"
                        className={`threadCard ${active ? "active" : ""}`}
                        onClick={() => setSelectedThreadId(thread.id)}
                      >
                        <p className="threadTitle">{threadLabel(thread)}</p>
                        <p className="threadMeta">
                          {formatEpochSeconds(thread.updatedAt)} | {thread.source || "unknown"}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="panel conversationPanel">
          <div className="sectionHead">
            <div>
              <h2>{selectedThread ? threadLabel(selectedThread) : "No thread selected"}</h2>
              <p className="sub">
                {selectedThread
                  ? `${selectedThread.id} | created ${formatEpochSeconds(selectedThread.createdAt)} | updated ${formatEpochSeconds(selectedThread.updatedAt)}`
                  : "Choose a thread from the list, or create a new one."}
              </p>
            </div>
            <div className="buttonRow">
              <button
                type="button"
                disabled={!selectedThreadId || threadLoading}
                onClick={() =>
                  selectedThreadId
                    ? loadSelectedThread(selectedThreadId).catch(setError)
                    : undefined
                }
              >
                Refresh thread
              </button>
              <button
                type="button"
                disabled={!selectedThreadId}
                onClick={interruptActiveTurn}
              >
                Interrupt
              </button>
            </div>
          </div>

          <div className="timeline" aria-live="polite">
            {threadLoading && !selectedThread ? <p className="sub">Loading thread...</p> : null}

            {!selectedThread ? <p className="sub">No thread loaded.</p> : null}

            {selectedThread && visibleTurnData.hasOlder ? (
              <button
                type="button"
                className="showOlderBtn"
                onClick={() => setVisibleTurns((count) => count + MAX_VISIBLE_TURNS_STEP)}
              >
                Show older turns ({visibleTurnData.allCount - visibleTurnData.turns.length} hidden)
              </button>
            ) : null}

            {selectedThread
              ? visibleTurnData.turns.map((turn, turnIndex) => (
                  <section className="turnBlock" key={turn.id || `${turnIndex}-${turn.status}`}>
                    <div className="turnBar">
                      <span>Turn {visibleTurnData.allCount - visibleTurnData.turns.length + turnIndex + 1}</span>
                      <span>{turn.status || "unknown"}</span>
                    </div>

                    {(Array.isArray(turn.items) ? turn.items : []).map((item, itemIndex) => (
                      <article className={`bubble ${getItemClass(item)}`} key={`${turn.id || turnIndex}-${item.id || itemIndex}`}>
                        <p className="bubbleRole">{getItemRole(item)}</p>
                        <pre>{getItemText(item)}</pre>
                      </article>
                    ))}
                  </section>
                ))
              : null}
          </div>

          <form className="compose" onSubmit={sendMessage}>
            <label htmlFor="composeInput">Send a message</label>
            <textarea
              id="composeInput"
              rows={4}
              value={composeText}
              onChange={(event) => setComposeText(event.target.value)}
              placeholder="Write a message to Codex..."
            />
            <div className="composeFooter">
              <p className="sub">
                {hasActiveTurn
                  ? "A turn is active. You can interrupt or wait for completion."
                  : "No active turn."}
              </p>
              <button type="submit" disabled={sending || !composeText.trim()}>
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </section>
      </section>

      <details className="panel advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
        <summary>Advanced debug tools</summary>

        <div className="advancedTopRow">
          <button type="button" onClick={() => setRawLive((active) => !active)}>
            {rawLive ? "Stop live raw feed" : "Start live raw feed"}
          </button>
          <button type="button" onClick={() => setRawEntries([])}>
            Clear raw entries
          </button>
          <p className="sub">
            Raw feed is optional and capped to {RAW_LOG_LIMIT} entries.
          </p>
        </div>

        <div className="rawLog">
          {!rawEntries.length ? (
            <p className="sub">Raw feed is empty.</p>
          ) : (
            rawEntries
              .slice()
              .reverse()
              .map((entry) => {
                const method = entry.meta?.method || entry.payload?.method || "-";
                const threadId = entry.meta?.threadId || "-";
                return (
                  <article key={entry.id} className="rawEntry">
                    <p className="rawHead">
                      {entry.at} | {entry.source}/{entry.direction} | {method} | {threadId}
                    </p>
                    <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
                  </article>
                );
              })
          )}
        </div>

        <div className="advancedGrid">
          <form onSubmit={submitRawRequest}>
            <h3>Raw request</h3>
            <label>
              Method
              <input
                value={rawRequestMethod}
                onChange={(event) => setRawRequestMethod(event.target.value)}
              />
            </label>
            <label>
              Target client id (optional)
              <input
                value={rawRequestTargetClientId}
                onChange={(event) => setRawRequestTargetClientId(event.target.value)}
              />
            </label>
            <label>
              Version (optional integer)
              <input
                type="number"
                min="0"
                value={rawRequestVersion}
                onChange={(event) => setRawRequestVersion(event.target.value)}
              />
            </label>
            <label>
              Params (JSON object)
              <textarea
                rows={6}
                value={rawRequestParams}
                onChange={(event) => setRawRequestParams(event.target.value)}
              />
            </label>
            <button type="submit">Send raw request</button>
          </form>

          <form onSubmit={submitRawBroadcast}>
            <h3>Raw broadcast</h3>
            <label>
              Method
              <input
                value={rawBroadcastMethod}
                onChange={(event) => setRawBroadcastMethod(event.target.value)}
              />
            </label>
            <label>
              Version (optional integer)
              <input
                type="number"
                min="0"
                value={rawBroadcastVersion}
                onChange={(event) => setRawBroadcastVersion(event.target.value)}
              />
            </label>
            <label>
              Params (JSON object)
              <textarea
                rows={6}
                value={rawBroadcastParams}
                onChange={(event) => setRawBroadcastParams(event.target.value)}
              />
            </label>
            <button type="submit">Send raw broadcast</button>
          </form>
        </div>
      </details>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
