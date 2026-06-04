const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginMessage = document.querySelector("#loginMessage");
const currentUser = document.querySelector("#currentUser");
const logoutButton = document.querySelector("#logoutButton");
const invoiceForm = document.querySelector("#invoiceForm");
const supplierName = document.querySelector("#supplierName");
const invoiceNumber = document.querySelector("#invoiceNumber");
const invoiceTotal = document.querySelector("#invoiceTotal");
const photoUrl = document.querySelector("#photoUrl");
const invoicePhoto = document.querySelector("#invoicePhoto");
const extractedText = document.querySelector("#extractedText");
const invoiceNotes = document.querySelector("#invoiceNotes");
const invoiceMessage = document.querySelector("#invoiceMessage");

let sessionToken = localStorage.getItem("kitchenStockToken") || "";
let sessionUser = localStorage.getItem("kitchenStockUser") || "";

function message(target, text, isError = false) {
  target.textContent = text;
  target.classList.toggle("error", isError);
}

function showApp() {
  loginScreen.hidden = true;
  currentUser.textContent = sessionUser;
}

function showLogin() {
  loginScreen.hidden = false;
  currentUser.textContent = "";
  sessionToken = "";
  sessionUser = "";
  localStorage.removeItem("kitchenStockToken");
  localStorage.removeItem("kitchenStockUser");
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    },
    ...options
  });
  const data = await response.json();
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(loginMessage, "Logging in...");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not log in.");
    sessionToken = data.token;
    sessionUser = data.user.name;
    localStorage.setItem("kitchenStockToken", sessionToken);
    localStorage.setItem("kitchenStockUser", sessionUser);
    passwordInput.value = "";
    showApp();
  } catch (error) {
    message(loginMessage, error.message, true);
  }
});

logoutButton.addEventListener("click", showLogin);
invoicePhoto.addEventListener("change", () => {
  if (invoicePhoto.files.length) {
    message(invoiceMessage, `Selected file: ${invoicePhoto.files[0].name}. Paste a public URL if you want Airtable to store the image link.`);
  }
});

invoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(invoiceMessage, "Saving...");
  try {
    await api("/api/invoice-captures", {
      method: "POST",
      body: JSON.stringify({
        supplierName: supplierName.value,
        invoiceNumber: invoiceNumber.value,
        invoiceTotal: invoiceTotal.value,
        photoUrl: photoUrl.value,
        extractedText: extractedText.value,
        notes: invoiceNotes.value
      })
    });
    invoiceForm.reset();
    message(invoiceMessage, "Invoice capture saved.");
  } catch (error) {
    message(invoiceMessage, error.message, true);
  }
});

if (sessionToken && sessionUser) {
  showApp();
} else {
  showLogin();
}
