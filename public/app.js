const appStatusBadge = document.getElementById("appStatusBadge");
const ipcStatusBadge = document.getElementById("ipcStatusBadge");

const refreshThreadsBtn = document.getElementById("refreshThreadsBtn");
const newThreadBtn = document.getElementById("newThreadBtn");
const refreshThreadBtn = document.getElementById("refreshThreadBtn");
const interruptBtn = document.getElementById("interruptBtn");

const threadListEl = document.getElementById("threadList");
const threadTitleEl = document.getElementById("threadTitle");
const threadMetaEl = document.getElementById("threadMeta");
const timelineEl = document.getElementById("timeline");

const composeForm = document.getElementById("composeForm");
const composeInput = document.getElementById("composeInput");
const composeHint = document.getElementById("composeHint");
const sendBtn = document.getElementById("sendBtn");

const rawLogEl = document.getElementById("rawLog");
const clearRawBtn = document.getElementById("clearRawBtn");

const rawRequestForm = document.getElementById("rawRequestForm");
const rawRequestMethodInput = document.getElementById("rawRequestMethod");
const rawRequestTargetClientIdInput = document.getElementById("rawRequestTargetClientId");
const rawRequestVersionInput = document.getElementById("rawRequestVersion");
const rawRequestParamsInput = document.getElementById("rawRequestParams");

const rawBroadcastForm = document.getElementById("rawBroadcastForm");
const rawBroadcastMethodInput = document.getElementById("rawBroadcastMethod");
const rawBroadcastVersionInput = document.getElementById("rawBroadcastVersion");
const rawBroadcastParamsInput = document.getElementById("rawBroadcastParams");

let globalState = null;
let threads = [];
let selectedThreadId = null;
let selectedThread = null;
let rawEntries = [];

const MAX_RAW_ENTRIES = 180;
const RAW_RENDER_DELAY_MS = 220;
const THREAD_LIST_REFRESH_METHODS = new Set([
  "thread/started",
  "thread/name/updated",
  "thread/archived",
  "turn/started",
  "turn/completed"
]);
const THREAD_DETAIL_REFRESH_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "item/completed"
]);

let refreshThreadsTimer = null;
let refreshSelectedThreadTimer = null;
let rawRenderTimer = null;
let loadingSelectedThread = false;
let sendingMessage = false;

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function formatEpochSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return "-";
  }
  const date = new Date(seconds * 1000);
  return date.toLocaleString();
}

function threadTitle(thread) {
  const preview = (thread.preview || "").trim();
  if (preview) {
    return preview.length > 95 ? `${preview.slice(0, 95)}...` : preview;
  }
  return `(thread ${thread.id.slice(0, 8)})`;
}

function setBadgeState(badgeEl, label, healthy, details) {
  badgeEl.textContent = `${label}: ${details}`;
  badgeEl.classList.toggle("good", healthy);
  badgeEl.classList.toggle("bad", !healthy);
}

function renderStatus() {
  if (!globalState) {
    setBadgeState(appStatusBadge, "App server", false, "loading");
    setBadgeState(ipcStatusBadge, "Desktop socket", false, "loading");
    return;
  }

  const app = globalState.app;
  const ipc = globalState.ipc;

  const appHealthy = Boolean(app.running && app.initialized);
  const appDetails = appHealthy
    ? `ready (pid ${app.pid || "?"})`
    : app.running
      ? "starting"
      : "disconnected";
  setBadgeState(appStatusBadge, "App server", appHealthy, appDetails);

  const ipcHealthy = Boolean(ipc.transportConnected && ipc.initialized);
  const ipcDetails = ipcHealthy ? "connected" : "disconnected";
  setBadgeState(ipcStatusBadge, "Desktop socket", ipcHealthy, ipcDetails);
}

function renderThreadList() {
  if (!threads.length) {
    threadListEl.innerHTML = "<li class='sub'>No threads found.</li>";
    return;
  }

  threadListEl.innerHTML = threads
    .map((thread) => {
      const activeClass = thread.id === selectedThreadId ? "active" : "";
      const title = escapeHtml(threadTitle(thread));
      const updated = escapeHtml(formatEpochSeconds(thread.updatedAt));
      const source = escapeHtml(thread.source || "unknown");
      return `<li class="thread-item ${activeClass}" data-thread-id="${escapeHtml(
        thread.id
      )}">
        <p class="title">${title}</p>
        <div class="meta">${updated} | ${source}</div>
      </li>`;
    })
    .join("");
}

function extractItemText(item) {
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
    const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
    return summary || "";
  }

  if (item.type === "plan") {
    return item.text || "";
  }

  return prettyJson(item);
}

function itemRoleLabel(item) {
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

function itemClass(item) {
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

function renderSelectedThread() {
  if (!selectedThread) {
    threadTitleEl.textContent = "No thread selected";
    threadMetaEl.textContent = "Choose a thread on the left.";
    timelineEl.innerHTML = "<p class='empty'>No thread loaded.</p>";
    composeHint.textContent =
      "If no thread is selected, a new one is created automatically.";
    return;
  }

  threadTitleEl.textContent = threadTitle(selectedThread);
  const created = formatEpochSeconds(selectedThread.createdAt);
  const updated = formatEpochSeconds(selectedThread.updatedAt);
  threadMetaEl.textContent = `${selectedThread.id} | created ${created} | updated ${updated}`;

  const turns = Array.isArray(selectedThread.turns) ? selectedThread.turns : [];
  if (!turns.length) {
    timelineEl.innerHTML = "<p class='empty'>This thread has no turns yet.</p>";
  } else {
    const html = turns
      .map((turn, index) => {
        const status = turn.status || "unknown";
        const head = `<div class="turn-bar"><span>Turn ${index + 1}</span><span>${escapeHtml(
          status
        )}</span></div>`;

        const items = Array.isArray(turn.items) ? turn.items : [];
        if (!items.length) {
          return `${head}<p class='sub'>No stored items for this turn.</p>`;
        }

        const bubbles = items
          .map((item) => {
            const role = escapeHtml(itemRoleLabel(item));
            const cls = escapeHtml(itemClass(item));
            const text = escapeHtml(extractItemText(item));
            return `<article class="bubble ${cls}">
              <p class="role">${role}</p>
              <pre>${text}</pre>
            </article>`;
          })
          .join("");

        return `${head}${bubbles}`;
      })
      .join("");
    timelineEl.innerHTML = html;
  }

  const activeTurn = turns.find((turn) => turn.status === "inProgress");
  if (activeTurn) {
    composeHint.textContent = `Active turn: ${activeTurn.id}. You can interrupt it.`;
  } else {
    composeHint.textContent = "No active turn. Send a message to start a new turn.";
  }
}

function renderRawLog() {
  if (!rawEntries.length) {
    rawLogEl.innerHTML = "<p class='sub'>No activity yet.</p>";
    return;
  }

  rawLogEl.innerHTML = rawEntries
    .slice()
    .reverse()
    .map((entry) => {
      const method = entry.meta?.method || entry.payload?.method || "-";
      const threadId = entry.meta?.threadId || "-";
      const head = `${entry.at} | ${entry.source}/${entry.direction} | ${method} | ${threadId}`;
      return `<article class="raw-entry">
        <div class="head">${escapeHtml(head)}</div>
        <pre>${escapeHtml(prettyJson(entry.payload))}</pre>
      </article>`;
    })
    .join("");
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
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

function parseJsonObject(text, label) {
  let parsed;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed;
}

function parseVersion(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Version must be an integer 0 or higher");
  }
  return value;
}

async function loadState() {
  const data = await getJson("/api/state");
  globalState = data.state;
  renderStatus();
}

async function loadThreads() {
  const data = await getJson("/api/threads?limit=80");
  threads = Array.isArray(data.data) ? data.data : [];

  if (!selectedThreadId && threads.length) {
    selectedThreadId = threads[0].id;
  }

  if (
    selectedThreadId &&
    !threads.some((thread) => thread.id === selectedThreadId)
  ) {
    selectedThreadId = threads[0]?.id || null;
    selectedThread = null;
  }

  renderThreadList();
}

async function loadSelectedThread() {
  if (!selectedThreadId || loadingSelectedThread) {
    return;
  }

  loadingSelectedThread = true;
  try {
    const data = await getJson(
      `/api/thread/${encodeURIComponent(selectedThreadId)}?includeTurns=true`
    );
    selectedThread = data.thread || null;
    renderSelectedThread();
  } catch (error) {
    alert(`Failed to load thread: ${error.message}`);
  } finally {
    loadingSelectedThread = false;
  }
}

function scheduleThreadsRefresh(delay = 450) {
  if (refreshThreadsTimer) {
    clearTimeout(refreshThreadsTimer);
  }
  refreshThreadsTimer = setTimeout(async () => {
    refreshThreadsTimer = null;
    try {
      await loadThreads();
    } catch {
      // ignore
    }
  }, delay);
}

function scheduleSelectedThreadRefresh(delay = 320) {
  if (refreshSelectedThreadTimer) {
    clearTimeout(refreshSelectedThreadTimer);
  }
  refreshSelectedThreadTimer = setTimeout(async () => {
    refreshSelectedThreadTimer = null;
    try {
      await loadSelectedThread();
    } catch {
      // ignore
    }
  }, delay);
}

function scheduleRawLogRender(delay = RAW_RENDER_DELAY_MS) {
  if (rawRenderTimer) {
    return;
  }
  rawRenderTimer = setTimeout(() => {
    rawRenderTimer = null;
    renderRawLog();
  }, delay);
}

function trackRawEntry(entry) {
  rawEntries.push(entry);
  if (rawEntries.length > MAX_RAW_ENTRIES) {
    rawEntries = rawEntries.slice(rawEntries.length - MAX_RAW_ENTRIES);
  }
  scheduleRawLogRender();
}

function onIncomingHistoryEntry(entry) {
  trackRawEntry(entry);

  if (entry.source !== "app" || entry.direction !== "in-notification") {
    return;
  }

  const method = entry.meta?.method || entry.payload?.method || "";
  if (!method) {
    return;
  }
  const threadId =
    entry.meta?.threadId ||
    entry.payload?.params?.threadId ||
    entry.payload?.params?.thread?.id ||
    entry.payload?.params?.conversationId ||
    null;

  if (THREAD_LIST_REFRESH_METHODS.has(method)) {
    scheduleThreadsRefresh();
  }

  if (
    selectedThreadId &&
    threadId &&
    threadId === selectedThreadId &&
    THREAD_DETAIL_REFRESH_METHODS.has(method)
  ) {
    scheduleSelectedThreadRefresh();
  }
}

async function ensureThreadSelected() {
  if (selectedThreadId) {
    return selectedThreadId;
  }

  const start = await postJson("/api/thread/start", {});
  const newThreadId = start.thread?.id;
  if (!newThreadId) {
    throw new Error("Failed to create a new thread");
  }

  selectedThreadId = newThreadId;
  await loadThreads();
  await loadSelectedThread();
  return selectedThreadId;
}

threadListEl.addEventListener("click", async (event) => {
  const item = event.target.closest(".thread-item");
  if (!item) {
    return;
  }
  const threadId = item.getAttribute("data-thread-id");
  if (!threadId || threadId === selectedThreadId) {
    return;
  }
  selectedThreadId = threadId;
  selectedThread = null;
  renderThreadList();
  renderSelectedThread();
  await loadSelectedThread();
});

refreshThreadsBtn.addEventListener("click", async () => {
  await loadThreads();
});

newThreadBtn.addEventListener("click", async () => {
  try {
    const result = await postJson("/api/thread/start", {});
    const threadId = result.thread?.id;
    if (!threadId) {
      throw new Error("No thread id returned");
    }
    selectedThreadId = threadId;
    selectedThread = null;
    await loadThreads();
    await loadSelectedThread();
  } catch (error) {
    alert(`Failed to create thread: ${error.message}`);
  }
});

refreshThreadBtn.addEventListener("click", async () => {
  await loadSelectedThread();
});

interruptBtn.addEventListener("click", async () => {
  if (!selectedThreadId) {
    alert("Select a thread first.");
    return;
  }

  try {
    await postJson(`/api/thread/${encodeURIComponent(selectedThreadId)}/interrupt`, {});
    scheduleSelectedThreadRefresh(120);
  } catch (error) {
    alert(`Failed to interrupt: ${error.message}`);
  }
});

composeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sendingMessage) {
    return;
  }

  const text = composeInput.value.trim();
  if (!text) {
    alert("Message text is required.");
    return;
  }

  sendingMessage = true;
  sendBtn.disabled = true;
  try {
    const threadId = await ensureThreadSelected();
    await postJson(`/api/thread/${encodeURIComponent(threadId)}/message`, { text });
    composeInput.value = "";
    scheduleThreadsRefresh(120);
    scheduleSelectedThreadRefresh(160);
  } catch (error) {
    alert(`Failed to send message: ${error.message}`);
  } finally {
    sendingMessage = false;
    sendBtn.disabled = false;
  }
});

clearRawBtn.addEventListener("click", () => {
  rawEntries = [];
  if (rawRenderTimer) {
    clearTimeout(rawRenderTimer);
    rawRenderTimer = null;
  }
  renderRawLog();
});

rawRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const method = rawRequestMethodInput.value.trim();
  if (!method) {
    alert("Method is required.");
    return;
  }

  let params;
  try {
    params = parseJsonObject(rawRequestParamsInput.value, "Request params");
  } catch (error) {
    alert(error.message);
    return;
  }

  let version;
  try {
    version = parseVersion(rawRequestVersionInput.value);
  } catch (error) {
    alert(error.message);
    return;
  }

  try {
    const result = await postJson("/api/send-request", {
      method,
      targetClientId: rawRequestTargetClientIdInput.value.trim(),
      version,
      params
    });
    alert(`Raw request sent: ${result.requestId}`);
  } catch (error) {
    alert(error.message);
  }
});

rawBroadcastForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const method = rawBroadcastMethodInput.value.trim();
  if (!method) {
    alert("Method is required.");
    return;
  }

  let params;
  try {
    params = parseJsonObject(rawBroadcastParamsInput.value, "Broadcast params");
  } catch (error) {
    alert(error.message);
    return;
  }

  let version;
  try {
    version = parseVersion(rawBroadcastVersionInput.value);
  } catch (error) {
    alert(error.message);
    return;
  }

  try {
    await postJson("/api/send-broadcast", { method, version, params });
    alert("Raw broadcast sent.");
  } catch (error) {
    alert(error.message);
  }
});

const eventSource = new EventSource("/events");
eventSource.onmessage = (event) => {
  let payload;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return;
  }

  if (payload.type === "state" && payload.state) {
    globalState = payload.state;
    renderStatus();
    return;
  }

  if (payload.type === "history" && Array.isArray(payload.messages)) {
    rawEntries = payload.messages.slice(-MAX_RAW_ENTRIES);
    scheduleRawLogRender(20);
    return;
  }

  if (payload.type === "message" && payload.entry) {
    onIncomingHistoryEntry(payload.entry);
  }
};

eventSource.onerror = () => {
  appStatusBadge.textContent = "App server: browser stream disconnected";
  appStatusBadge.classList.remove("good");
  appStatusBadge.classList.add("bad");
};

async function boot() {
  try {
    await loadState();
    await loadThreads();
    if (selectedThreadId) {
      await loadSelectedThread();
    } else {
      renderSelectedThread();
    }
  } catch (error) {
    alert(`Failed to initialize app: ${error.message}`);
  }
}

boot();
