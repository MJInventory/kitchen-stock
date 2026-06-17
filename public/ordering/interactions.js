import { itemUnit } from "./shared.js";

export function attachOrderingInteractions({
  loginForm,
  usernameInput,
  passwordInput,
  setLoginMessage,
  saveSession,
  showApp,
  showLogin,
  refresh,
  refreshSession,
  submitButton,
  submitSelected,
  featureMenu,
  backofficeMenu,
  refreshButton,
  categoryGrid,
  activeCategoryRef,
  categoryView,
  productView,
  render,
  backButton,
  productList,
  toggleProduct,
  updateCurrentStock,
  ensureRowSelection,
  allItemsRef,
  setMessage,
  syncProductRow,
  selectedRef,
  selectItem,
  selectedChips,
  dailyOrderList,
  jumpToItem,
  deliverDailyOrder,
  deleteDailyOrder,
  notificationList,
  markNotificationsRead,
  readAllNotificationsButton,
  areaFilter,
  locationFilter,
  hasSearchTerm,
  requestScopeFilter,
  renderOrderingSummary,
  renderDailyOrder,
  renderCategories,
  renderProductList,
  orderingSummaryCards,
  orderingSummaryFilterRef,
  searchInput,
  sessionToken,
  sessionUser,
  updateSaveButton,
  loadBootstrapCache,
  applyBootstrapData,
  applyPendingJump
}) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginMessage("Logging in...");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.value,
          password: passwordInput.value
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not log in.");

      saveSession(data);
      if (data.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      passwordInput.value = "";
      setLoginMessage("");
      showApp();
      await refresh();
    } catch (error) {
      setLoginMessage(error.message, true);
    }
  });

  document.querySelector("#logoutButton")?.addEventListener("click", showLogin);
  [featureMenu, backofficeMenu].forEach((menu) => menu?.addEventListener("change", (event) => {
    if (event.target.value) window.location.href = event.target.value;
  }));
  refreshButton?.addEventListener("click", () => refresh().catch((error) => setMessage(error.message, true)));
  window.addEventListener("kitchen-offline-queue-synced", () => {
    refresh(true).catch((error) => setMessage(error.message, true));
  });
  submitButton.addEventListener("click", () => submitSelected());

  categoryGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".category-card");
    if (!card) return;
    activeCategoryRef.set(card.dataset.category);
    categoryView.hidden = true;
    productView.hidden = false;
    render();
  });

  backButton.addEventListener("click", () => {
    activeCategoryRef.set("");
    productView.hidden = true;
    categoryView.hidden = false;
    render();
  });

  productList.addEventListener("click", (event) => {
    const row = event.target.closest(".product-row");
    if (!row) return;
    const clickedInteractive = event.target.closest("button, input, select, label, a");

    if (event.target.closest(".product-check")) {
      toggleProduct(row);
      return;
    }

    if (event.target.closest(".stock-save")) {
      const itemId = row.dataset.itemId;
      const input = row.querySelector(".stock-input");
      const button = event.target.closest(".stock-save");
      button.disabled = true;
      updateCurrentStock(itemId, input.value)
        .then(() => {
          render();
          setMessage("Current stock updated.");
        })
        .catch((error) => setMessage(error.message, true))
        .finally(() => {
          button.disabled = false;
        });
      return;
    }

    if (event.target.closest(".row-save-button")) {
      const button = event.target.closest(".row-save-button");
      const item = ensureRowSelection(row);
      if (!item) {
        setMessage("Choose a valid item first.", true);
        return;
      }
      button.disabled = true;
      submitSelected([item.id])
        .catch((error) => setMessage(error.message, true))
        .finally(() => {
          button.disabled = false;
        });
      return;
    }

    if (event.target.closest(".qty-minus") || event.target.closest(".qty-plus")) {
      const input = row.querySelector(".qty-input");
      const delta = event.target.closest(".qty-plus") ? 1 : -1;
      input.value = Math.max(0, Number(input.value || 0) + delta);
      if (Number(input.value) > 0) {
        const item = allItemsRef().find((candidate) => candidate.id === row.dataset.itemId);
        if (item && !selectedRef().has(item.id)) {
          selectItem(item, input.value, row.querySelector(".urgency-input").value);
          const entry = selectedRef().get(item.id);
          if (entry) entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
        }
      }
      syncProductRow(row);
      render();
      return;
    }

    if (!clickedInteractive) {
      toggleProduct(row);
    }
  });

  productList.addEventListener("change", (event) => {
    const row = event.target.closest(".product-row");
    if (!row) return;

    if (event.target.matches(".qty-input") && Number(event.target.value || 0) > 0) {
      const item = allItemsRef().find((candidate) => candidate.id === row.dataset.itemId);
      if (item && !selectedRef().has(item.id)) {
        selectItem(item, event.target.value, row.querySelector(".urgency-input").value);
        const entry = selectedRef().get(item.id);
        if (entry) entry.unit = row.querySelector(".unit-input")?.value || itemUnit(item);
      }
    }

    syncProductRow(row);
    render();
  });

  selectedChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-remove-id]");
    if (!chip) return;
    selectedRef().delete(chip.dataset.removeId);
    render();
  });

  dailyOrderList.addEventListener("click", (event) => {
    const jumpButton = event.target.closest(".order-sheet-item-link");
    if (jumpButton) {
      jumpToItem(jumpButton.dataset.jumpItemId, jumpButton.dataset.jumpCategory);
      return;
    }

    const deliverButton = event.target.closest(".deliver-order-button");
    if (deliverButton) {
      if (!window.confirm("Mark this item as received and add it to inventory?")) return;
      deliverButton.disabled = true;
      deliverDailyOrder(deliverButton.dataset.deliverId).catch((error) => {
        setMessage(error.message, true);
        deliverButton.disabled = false;
      });
      return;
    }

    const button = event.target.closest(".delete-order-button");
    if (!button) return;
    if (!window.confirm("Remove this item from the order list?")) return;

    button.disabled = true;
    deleteDailyOrder(button.dataset.requestId).catch((error) => {
      setMessage(error.message, true);
      button.disabled = false;
    });
  });

  notificationList?.addEventListener("click", (event) => {
    const button = event.target.closest(".mark-notification-read");
    if (!button) return;
    const row = button.closest("[data-notification-id]");
    if (!row?.dataset.notificationId) return;
    button.disabled = true;
    markNotificationsRead([row.dataset.notificationId]).catch((error) => {
      setMessage(error.message, true);
      button.disabled = false;
    });
  });

  readAllNotificationsButton?.addEventListener("click", () => {
    readAllNotificationsButton.disabled = true;
    markNotificationsRead().catch((error) => {
      setMessage(error.message, true);
    }).finally(() => {
      readAllNotificationsButton.disabled = false;
    });
  });

  [areaFilter, locationFilter].forEach((control) => {
    control.addEventListener("input", () => {
      if (!productView.hidden && !hasSearchTerm()) {
        activeCategoryRef.set("");
        productView.hidden = true;
        categoryView.hidden = false;
      }
      render();
    });
  });

  requestScopeFilter?.addEventListener("change", () => {
    renderOrderingSummary();
    renderDailyOrder();
    renderCategories();
    if (!productView.hidden || hasSearchTerm()) renderProductList();
  });

  orderingSummaryCards?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-ordering-filter]");
    if (!card) return;
    const nextFilter = String(card.dataset.orderingFilter || "").trim();
    orderingSummaryFilterRef.set(orderingSummaryFilterRef.get() === nextFilter ? "all" : nextFilter);
    render();
  });

  ["input", "change", "search"].forEach((eventName) => {
    searchInput.addEventListener(eventName, () => {
      if (!productView.hidden && !hasSearchTerm()) {
        activeCategoryRef.set("");
        productView.hidden = true;
        categoryView.hidden = false;
      }
      render();
    });
  });

  if (sessionToken() && sessionUser()) {
    showApp();
    const cached = loadBootstrapCache();
    if (cached) {
      applyBootstrapData(cached);
      applyPendingJump();
      setMessage("");
    }
    refreshSession()
      .then((ok) => {
        if (ok) return refresh(Boolean(cached));
        return null;
      })
      .catch((error) => setMessage(error.message, true));
  } else {
    showLogin();
    updateSaveButton();
  }
}
