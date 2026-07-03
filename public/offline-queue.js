(function () {
  const QUEUE_KEY = "kitchenStockOfflineQueue";
  const FLASH_MS = 12000;
  let syncing = false;
  let flashMessage = "";
  let flashUntil = 0;

  function nowIso() {
    return new Date().toISOString();
  }

  function safeParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function loadQueue() {
    return safeParse(localStorage.getItem(QUEUE_KEY) || "[]", []).filter((entry) => entry && entry.id && entry.path);
  }

  function saveQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function readSessionToken() {
    try {
      return window.kitchenSessionBridge?.readKitchenSession?.(localStorage)?.token || localStorage.getItem("kitchenStockToken") || "";
    } catch {
      return localStorage.getItem("kitchenStockToken") || "";
    }
  }

  function currentToken() {
    return readSessionToken();
  }

  function normalizeHeaders(headers = {}, body = undefined) {
    const normalized = {};
    const source = headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers || {});
    for (const [key, value] of source) {
      if (value === undefined || value === null || value === "") continue;
      normalized[key] = value;
    }
    if (body !== undefined && !normalized["Content-Type"] && !normalized["content-type"]) {
      normalized["Content-Type"] = "application/json";
    }
    const token = currentToken();
    if (token && !normalized.Authorization) {
      normalized.Authorization = `Bearer ${token}`;
    }
    return normalized;
  }

  async function readResponseJson(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  function injectStatusBar() {
    let bar = document.querySelector("#offlineQueueStatus");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "offlineQueueStatus";
    bar.className = "offline-queue-status";
    bar.hidden = true;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    document.body.appendChild(bar);
    return bar;
  }

  function setFlash(messageText) {
    flashMessage = messageText;
    flashUntil = Date.now() + FLASH_MS;
  }

  function queueState() {
    return {
      online: navigator.onLine,
      syncing,
      queuedCount: loadQueue().length,
      flashMessage: Date.now() < flashUntil ? flashMessage : ""
    };
  }

  function emitState() {
    const detail = queueState();
    window.dispatchEvent(new CustomEvent("kitchen-offline-queue-update", { detail }));
    return detail;
  }

  function renderStatus() {
    const bar = injectStatusBar();
    const detail = emitState();
    const { online, syncing: syncingNow, queuedCount, flashMessage: flash } = detail;

    let text = "";
    let tone = "idle";
    if (syncingNow) {
      text = `Syncing ${queuedCount} offline save${queuedCount === 1 ? "" : "s"}...`;
      tone = "syncing";
    } else if (!online && queuedCount) {
      text = `Offline. ${queuedCount} save${queuedCount === 1 ? "" : "s"} waiting for signal.`;
      tone = "offline";
    } else if (!online) {
      text = "Offline. New saves will wait here until the signal comes back.";
      tone = "offline";
    } else if (queuedCount) {
      text = `${queuedCount} save${queuedCount === 1 ? "" : "s"} waiting to sync.`;
      tone = "queued";
    } else if (flash) {
      text = flash;
      tone = "done";
    }

    bar.hidden = !text;
    if (!text) return;
    bar.className = `offline-queue-status ${tone}`;
    bar.textContent = text;
  }

  function queueWrite(path, options = {}, meta = {}) {
    const body = options.body === undefined
      ? ""
      : (typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      method: String(options.method || "POST").toUpperCase(),
      path,
      headers: normalizeHeaders(options.headers || {}, body),
      body,
      label: String(meta.label || "Offline save").trim(),
      queuedAt: nowIso()
    };
    const queue = loadQueue();
    queue.push(entry);
    saveQueue(queue);
    setFlash(`${entry.label} saved offline. It will sync automatically.`);
    renderStatus();
    return {
      ...(meta.fallbackData || {}),
      offlineQueued: true,
      queuedActionId: entry.id
    };
  }

  function shouldQueueError(error) {
    return error instanceof TypeError || /fetch|network|internet|failed/i.test(String(error?.message || ""));
  }

  async function syncQueue() {
    if (syncing || !navigator.onLine) {
      renderStatus();
      return queueState();
    }
    const queue = loadQueue();
    if (!queue.length) {
      renderStatus();
      return queueState();
    }

    syncing = true;
    renderStatus();
    const remaining = [];
    let syncedCount = 0;

    for (const entry of queue) {
      try {
        const response = await fetch(entry.path, {
          method: entry.method,
          headers: normalizeHeaders(entry.headers || {}, entry.body),
          body: entry.body || undefined
        });
        const data = await readResponseJson(response);
        if (!response.ok) {
          remaining.push({ ...entry, lastError: data.error || `HTTP ${response.status}` });
          continue;
        }
        syncedCount += 1;
      } catch (error) {
        remaining.push({ ...entry, lastError: error.message || "Network error" });
      }
    }

    saveQueue(remaining);
    syncing = false;
    if (syncedCount) {
      setFlash(`Synced ${syncedCount} offline save${syncedCount === 1 ? "" : "s"}.`);
      window.dispatchEvent(new CustomEvent("kitchen-offline-queue-synced", {
        detail: { syncedCount, pendingCount: remaining.length }
      }));
    }
    renderStatus();
    return queueState();
  }

  async function request(path, options = {}, meta = {}) {
    const body = options.body === undefined
      ? undefined
      : (typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    const requestOptions = {
      ...options,
      method: String(options.method || "GET").toUpperCase(),
      headers: normalizeHeaders(options.headers || {}, body),
      body
    };

    if (meta.allowQueue && !navigator.onLine) {
      return queueWrite(path, requestOptions, meta);
    }

    try {
      const response = await fetch(path, requestOptions);
      const data = await readResponseJson(response);
      if (!response.ok) {
        const error = new Error(data.error || "Something went wrong.");
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } catch (error) {
      if (meta.allowQueue && shouldQueueError(error)) {
        return queueWrite(path, requestOptions, meta);
      }
      throw error;
    }
  }

  window.kitchenOfflineQueue = {
    request,
    syncQueue,
    getState: queueState
  };

  window.addEventListener("online", () => {
    setFlash("Connection is back. Syncing offline saves...");
    syncQueue().catch(() => renderStatus());
  });
  window.addEventListener("focus", () => {
    syncQueue().catch(() => renderStatus());
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncQueue().catch(() => renderStatus());
    }
  });

  renderStatus();
})();
