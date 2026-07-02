import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#categoryMessage"
});

const categoryForm = document.querySelector("#categoryForm");
const categoryList = document.querySelector("#categoryList");
const categoryMessage = document.querySelector("#categoryMessage");
let categoryRecords = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setCategoryMessage(text, isError = false) {
  categoryMessage.textContent = text;
  categoryMessage.classList.toggle("error", isError);
}

function renderCategories(categories) {
  categoryRecords = categories || [];
  categoryList.innerHTML = (categories || [])
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .map((category) => `
      <article class="setting-row setup-admin-row category-row" data-category-id="${escapeHtml(category.id)}">
        <label>Category <input class="category-name" type="text" value="${escapeHtml(category.name)}"></label>
        <button class="danger-button delete-category" type="button">Delete</button>
      </article>
    `)
    .join("");

  if (!categoryList.innerHTML) {
    categoryList.innerHTML = '<p class="empty-sheet">No categories yet.</p>';
  }
}

async function loadCategories() {
  setCategoryMessage("Loading...");
  const data = await page.api("/api/setup/categories");
  renderCategories(data.categories || []);
  setCategoryMessage("");
}

function getCategoryRecord(row) {
  return categoryRecords.find((category) => category.id === row.dataset.categoryId);
}

function isCategoryDirty(row) {
  const record = getCategoryRecord(row);
  if (!record) return false;
  return (row.querySelector(".category-name")?.value || "") !== String(record.name || "");
}

async function saveCategoryRow(row) {
  if (!row || row.dataset.saving === "true" || !isCategoryDirty(row)) return;
  row.dataset.saving = "true";
  row.classList.add("dirty");
  setCategoryMessage("Saving category...");
  try {
    await page.api(`/api/setup/categories/${row.dataset.categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".category-name").value
      })
    });
    await loadCategories();
    setCategoryMessage("Category saved.");
  } finally {
    row.dataset.saving = "false";
  }
}

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setCategoryMessage("Adding category...");
  try {
    await page.api("/api/setup/categories", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#categoryName").value
      })
    });
    categoryForm.reset();
    await loadCategories();
    setCategoryMessage("Category added.");
  } catch (error) {
    setCategoryMessage(error.message, true);
  }
});

categoryList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".delete-category");
  if (!deleteButton) return;
  const row = deleteButton.closest(".category-row");
  const name = row.querySelector(".category-name").value || "this category";
  if (!window.confirm(`Delete ${name}?`)) return;
  deleteButton.disabled = true;
  page.api(`/api/setup/categories/${row.dataset.categoryId}`, {
    method: "DELETE"
  })
    .then(loadCategories)
    .then(() => setCategoryMessage("Category deleted."))
    .catch((error) => setCategoryMessage(error.message, true))
    .finally(() => { deleteButton.disabled = false; });
});

categoryList.addEventListener("input", (event) => {
  const row = event.target.closest(".category-row");
  if (!row) return;
  row.classList.toggle("dirty", isCategoryDirty(row));
});

categoryList.addEventListener("focusout", (event) => {
  const row = event.target.closest(".category-row");
  if (!row) return;
  const next = event.relatedTarget;
  if (next && row.contains(next)) return;
  saveCategoryRow(row).catch((error) => setCategoryMessage(error.message, true));
});

page.ready(loadCategories);
