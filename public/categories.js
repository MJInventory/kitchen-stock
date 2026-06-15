import { authPage } from "/page-auth.js";

const page = authPage({
  permission: "canAddInventoryItems",
  messageSelector: "#categoryMessage"
});

const categoryForm = document.querySelector("#categoryForm");
const categoryList = document.querySelector("#categoryList");
const categoryMessage = document.querySelector("#categoryMessage");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function setCategoryMessage(text, isError = false) {
  categoryMessage.textContent = text;
  categoryMessage.classList.toggle("error", isError);
}

function renderCategories(categories) {
  categoryList.innerHTML = (categories || [])
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
    .map((category) => `
      <article class="setting-row setup-admin-row category-row" data-category-id="${escapeHtml(category.id)}">
        <label>Category <input class="category-name" type="text" value="${escapeHtml(category.name)}"></label>
        <button class="save-category" type="button">Save</button>
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
  const saveButton = event.target.closest(".save-category");
  if (saveButton) {
    const row = saveButton.closest(".category-row");
    saveButton.disabled = true;
    page.api(`/api/setup/categories/${row.dataset.categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: row.querySelector(".category-name").value
      })
    })
      .then(loadCategories)
      .then(() => setCategoryMessage("Category saved."))
      .catch((error) => setCategoryMessage(error.message, true))
      .finally(() => { saveButton.disabled = false; });
    return;
  }

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

page.ready(loadCategories);
