export function createJsonApiClient({
  getToken,
  onUnauthorized,
  onPasswordChangeRequired,
  defaultErrorMessage = "Something went wrong.",
  fetchImpl = fetch,
  windowObject = window
}) {
  return async function api(path, options = {}) {
    const token = getToken?.() || "";
    const headers = {
      ...(!(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };
    const response = await fetchImpl(path, {
      ...options,
      headers
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
  };
}
