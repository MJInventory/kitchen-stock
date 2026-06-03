const itemSelect = document.querySelector("#itemSelect");
const requestForm = document.querySelector("#requestForm");
const quantityInput = document.querySelector("#quantityInput");
const urgencySelect = document.querySelector("#urgencySelect");
const requestedByInput = document.querySelector("#requestedByInput");
const notesInput = document.querySelector("#notesInput");
const submitButton = document.querySelector("#submitButton");
const refreshButton = document.querySelector("#refreshButton");
const message = document.querySelector("#message");
const requestList = document.querySelector("#requestList");

let itemNameById = new Map();
let recentRequests = [];

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function renderItems(items) {
  itemNameById = new Map(items.map((item) => [item.id, item.name]));
  itemSelect.innerHTML = items
    .map((item) => {
      const detail = [item.quantity, item.unit].filter(Boolean).join(" ");
      return `<option value="${item.id}">${item.name}${detail ? ` (${detail})` : ""}</option>`;
    })
    .join("");
}

function renderRequests(requests) {
  requestList.innerHTML = requests
    .map((request) => {
      const itemName = itemNameById.get(request.itemId) || "Requested item";
      const qty = request.quantity ? `${request.quantity}` : "";
      return `
        <article class="request">
          <strong>${itemName}</strong>
          <span>${qty} needed - ${request.urgency || "Medium"} - ${request.status || "Pending"}</span>
          <span>${request.requestedBy || "Kitchen"}</span>
        </article>
      `;
    })
    .join("");
}

async function refresh() {
  setMessage("Loading...");
  const data = await api("/api/bootstrap");
  recentRequests = data.requests;
  renderItems(data.items);
  renderRequests(recentRequests);
  setMessage("");
}

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  setMessage("Submitting...");

  try {
    const data = await api("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        itemId: itemSelect.value,
        quantityNeeded: quantityInput.value,
        urgencyLevel: urgencySelect.value,
        requestedBy: requestedByInput.value,
        notes: notesInput.value
      })
    });

    quantityInput.value = "";
    notesInput.value = "";
    setMessage("Request submitted.");
    recentRequests = [data.request, ...recentRequests].slice(0, 20);
    renderRequests(recentRequests);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

refreshButton.addEventListener("click", () => {
  refresh().catch((error) => setMessage(error.message, true));
});

refresh().catch((error) => setMessage(error.message, true));
