async function readJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  return text ? { error: text } : {};
}

export async function requestKitchenLogin({
  username,
  password,
  fetchImpl = fetch
}) {
  const response = await fetchImpl("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(data.error || "Could not log in.");
  }
  return data;
}

export function bindKitchenLogin({
  loginForm,
  usernameInput,
  passwordInput,
  setLoginMessage,
  onSuccess
}) {
  if (!loginForm) return;
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginMessage("Logging in...");
    try {
      const data = await requestKitchenLogin({
        username: usernameInput?.value || "",
        password: passwordInput?.value || ""
      });
      await onSuccess(data);
    } catch (error) {
      setLoginMessage(error.message || "Could not log in.", true);
    }
  });
}
