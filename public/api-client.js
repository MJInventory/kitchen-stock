export function createJsonApiClient({
  getToken,
  onUnauthorized,
  onPasswordChangeRequired,
  defaultErrorMessage = "Something went wrong.",
  requestTimeoutMs = 20000,
  fetchImpl = fetch,
  windowObject = window
}) {
  return async function api(path, options = {}) {
    const token = getToken?.() || "";
    const timeoutMs = Number(options.timeoutMs ?? requestTimeoutMs);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const setTimer = typeof windowObject?.setTimeout === "function" ? windowObject.setTimeout.bind(windowObject) : setTimeout;
    const clearTimer = typeof windowObject?.clearTimeout === "function" ? windowObject.clearTimeout.bind(windowObject) : clearTimeout;
    const timeoutHandle = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimer(() => controller.abort(), timeoutMs)
      : null;
    const headers = {
      ...(!(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };
    try {
      const response = await fetchImpl(path, {
        ...options,
        headers,
        signal: options.signal || controller?.signal
      });
      let data = {};
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = text ? { error: text } : {};
      }
      if (response.status === 401) onUnauthorized?.({ response, data });
      if (response.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") {
        if (onPasswordChangeRequired) onPasswordChangeRequired({ response, data });
        else windowObject.location.href = "/change-password.html";
      }
      if (!response.ok) throw new Error(data.error || defaultErrorMessage);
      return data;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      if (timeoutHandle) {
        clearTimer(timeoutHandle);
      }
    }
  };
}
