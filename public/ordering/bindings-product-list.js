import { itemUnit } from "./shared.js";

export function bindOrderingProductList({
  productList,
  toggleProduct,
  allItemsRef,
  selectedRef,
  selectItem,
  syncProductRow,
  render,
  ensureRowSelection,
  submitSelected,
  setMessage
}) {
  productList.addEventListener("click", (event) => {
    const row = event.target.closest(".product-row");
    if (!row) return;
    const clickedInteractive = event.target.closest("button, input, select, label, a");

    if (event.target.closest(".product-check")) {
      const item = toggleProduct(row);
      if (!item) {
        setMessage("Choose a valid item first.", true);
        return;
      }
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
      const item = toggleProduct(row);
      if (!item) {
        setMessage("Choose a valid item first.", true);
        return;
      }
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
}

export function bindOrderingSelectedChips({ selectedChips, selectedRef, render }) {
  selectedChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-remove-id]");
    if (!chip) return;
    selectedRef().delete(chip.dataset.removeId);
    render();
  });
}
