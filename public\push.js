(function () {
  const PROMPT_KEY = "kitchenStockPushPromptedV1";
  let started = false;
  let subscribeAttempted = false;
  let pushStatus = { supported: false, permission: "default", subscribed: false, enabled: false };

  function token() {
    return localStorage.getItem("kitchenStockToken") || "";
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(token() ? { Authorization: `Bearer ${token()}` } : {})
      },
      ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Push request failed.");
    return data;
  }

  function emitStatus() {
    pushStatus = {
      ...pushStatus,
      supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
      permission: ("Notification" in window ? Notification.permission : "unsupported")
    };
    window.kitchenPushStatus = pushStatus;
    window.dispatchEvent(new CustomEvent("kitchen-push-status", { detail: pushStatus }));
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function unsubscribeIfNeeded(registration) {
    const existing = await registration.pushManager.getSubscription();
    pushStatus.subscribed = false;
    emitStatus();
    if (!existing) return;
    await api("/api/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: existing.endpoint })
    }).catch(() => {});
    await existing.unsubscribe().catch(() => {});
  }

  async function ensureSubscribed(forcePrompt = false) {
    if (subscribeAttempted || !token() || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      emitStatus();
      return;
    }
    subscribeAttempted = true;

    const registration = await navigator.serviceWorker.ready;
    const config = await api("/api/push/public-key");
    pushStatus.enabled = Boolean(config.enabled && config.publicKey);
    emitStatus();
    if (!config.enabled || !config.publicKey) return;

    if (Notification.permission === "denied") {
      await unsubscribeIfNeeded(registration);
      return;
    }

    if (Notification.permission === "default" && (forcePrompt || !localStorage.getItem(PROMPT_KEY))) {
      localStorage.setItem(PROMPT_KEY, "1");
      const permission = await Notification.requestPermission();
      emitStatus();
      if (permission !== "granted") return;
    }

    if (Notification.permission !== "granted") return;

    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await api("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ subscription: existing.toJSON() })
      });
      pushStatus.subscribed = true;
      emitStatus();
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });

    await api("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
    pushStatus.subscribed = true;
    emitStatus();
  }

  function start() {
    if (started) return;
    started = true;
    const trySetup = () => {
      ensureSubscribed().catch(() => {});
    };
    window.addEventListener("focus", trySetup);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") trySetup();
    });
    window.addEventListener("storage", trySetup);
    window.setupKitchenPush = trySetup;
    window.enableKitchenPush = async () => {
      subscribeAttempted = false;
      await ensureSubscribed(true);
    };
    emitStatus();
    trySetup();
    window.setInterval(trySetup, 20000);
  }

  start();
}());
