const form = document.querySelector("#passwordForm");
const currentPassword = document.querySelector("#currentPassword");
const newPassword = document.querySelector("#newPassword");
const repeatPassword = document.querySelector("#repeatPassword");
const message = document.querySelector("#passwordMessage");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function saveSession(data) {
  localStorage.setItem("kitchenStockToken", data.token);
  localStorage.setItem("kitchenStockUser", data.user.name);
  localStorage.setItem("kitchenStockRole", data.user.role || "user");
  localStorage.setItem("kitchenStockPermissions", JSON.stringify(data.user.permissions || {}));
  localStorage.setItem("kitchenStockTheme", data.user.theme || "dark");
  window.applyKitchenTheme?.(data.user.theme || "dark");
  sessionToken = data.token;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (newPassword.value !== repeatPassword.value) {
    setMessage("The new passwords do not match.", true);
    return;
  }

  setMessage("Updating password...");
  try {
    const data = await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    });
    saveSession(data);
    setMessage("Password updated.");
    window.location.href = "/";
  } catch (error) {
    setMessage(error.message, true);
  }
});

if (!sessionToken) {
  setMessage("Log in first, then change your password.", true);
}





