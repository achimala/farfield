const statusEl = document.getElementById("status");
const socketPathEl = document.getElementById("socketPath");
const transportConnectedEl = document.getElementById("transportConnected");
const initializedEl = document.getElementById("initialized");
const clientIdEl = document.getElementById("clientId");
const lastErrorEl = document.getElementById("lastError");
const logEl = document.getElementById("log");

const requestForm = document.getElementById("requestForm");
const requestMethodInput = document.getElementById("requestMethod");
const requestTargetClientIdInput = document.getElementById("requestTargetClientId");
const requestVersionInput = document.getElementById("requestVersion");
const requestParamsInput = document.getElementById("requestParams");

const broadcastForm = document.getElementById("broadcastForm");
const broadcastMethodInput = document.getElementById("broadcastMethod");
const broadcastVersionInput = document.getElementById("broadcastVersion");
const broadcastParamsInput = document.getElementById("broadcastParams");

const reconnectBtn = document.getElementById("reconnectBtn");
const clearBtn = document.getElementById("clearBtn");

let screenMessages = [];

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function setStatusText(state) {
  const live = state.transportConnected ? "Socket connected" : "Socket disconnected";
  const init = state.initialized ? "initialized" : "not initialized";
  statusEl.textContent = `${live}, ${init}`;
  statusEl.classList.toggle("good", Boolean(state.transportConnected));
  statusEl.classList.toggle("bad", !state.transportConnected);
}

function renderState(state) {
  setStatusText(state);
  socketPathEl.textContent = state.socketPath || "-";
  transportConnectedEl.textContent = state.transportConnected ? "yes" : "no";
  initializedEl.textContent = state.initialized ? "yes" : "no";
  clientIdEl.textContent = state.clientId || "-";
  lastErrorEl.textContent = state.lastError || "-";
}

function renderMessages() {
  const items = screenMessages
    .slice()
    .reverse()
    .map((entry) => {
      const meta = `${entry.at}  |  ${entry.direction}`;
      const body = prettyJson(entry.payload);
      return `<article class="entry"><div class="meta">${escapeHtml(meta)}</div><pre>${escapeHtml(body)}</pre></article>`;
    })
    .join("");

  logEl.innerHTML = items || "<p class='hint'>No messages yet.</p>";
}

function pushScreenMessage(entry) {
  screenMessages.push(entry);
  if (screenMessages.length > 1000) {
    screenMessages = screenMessages.slice(screenMessages.length - 1000);
  }
  renderMessages();
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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const method = requestMethodInput.value.trim();
  const targetClientId = requestTargetClientIdInput.value.trim();

  if (!method) {
    alert("Method is required");
    return;
  }

  let params;
  try {
    params = parseJsonObject(requestParamsInput.value, "Request params");
  } catch (error) {
    alert(error.message);
    return;
  }

  let version;
  try {
    version = parseVersion(requestVersionInput.value);
  } catch (error) {
    alert(error.message);
    return;
  }

  try {
    const result = await postJson("/api/send-request", {
      method,
      targetClientId,
      version,
      params
    });
    alert(`Request sent. requestId: ${result.requestId}`);
  } catch (error) {
    alert(error.message);
  }
});

broadcastForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const method = broadcastMethodInput.value.trim();
  if (!method) {
    alert("Method is required");
    return;
  }

  let params;
  try {
    params = parseJsonObject(broadcastParamsInput.value, "Broadcast params");
  } catch (error) {
    alert(error.message);
    return;
  }

  let version;
  try {
    version = parseVersion(broadcastVersionInput.value);
  } catch (error) {
    alert(error.message);
    return;
  }

  try {
    await postJson("/api/send-broadcast", {
      method,
      version,
      params
    });
    alert("Broadcast sent.");
  } catch (error) {
    alert(error.message);
  }
});

reconnectBtn.addEventListener("click", async () => {
  try {
    await postJson("/api/reconnect", {});
  } catch (error) {
    alert(error.message);
  }
});

clearBtn.addEventListener("click", () => {
  screenMessages = [];
  renderMessages();
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
    renderState(payload.state);
    return;
  }

  if (payload.type === "history" && Array.isArray(payload.messages)) {
    screenMessages = payload.messages.slice(-1000);
    renderMessages();
    return;
  }

  if (payload.type === "message" && payload.entry) {
    pushScreenMessage(payload.entry);
  }
};

eventSource.onerror = () => {
  statusEl.textContent = "Browser lost connection to monitor server";
  statusEl.classList.remove("good");
  statusEl.classList.add("bad");
};
