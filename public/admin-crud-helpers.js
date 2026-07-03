export function createStatusPresenter(element) {
  return function setStatus(text, isError = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("error", isError);
  };
}

export function bindAutosaveRows({
  container,
  rowSelector,
  isDirty,
  saveRow,
  onError
}) {
  if (!container) return;

  function syncRowState(row) {
    if (!row) return;
    row.classList.toggle("dirty", Boolean(isDirty(row)));
  }

  container.addEventListener("input", (event) => {
    syncRowState(event.target.closest(rowSelector));
  });

  container.addEventListener("change", (event) => {
    syncRowState(event.target.closest(rowSelector));
  });

  container.addEventListener("focusout", (event) => {
    const row = event.target.closest(rowSelector);
    if (!row) return;
    const next = event.relatedTarget;
    if (next && row.contains(next)) return;
    Promise.resolve(saveRow(row)).catch(onError);
  });
}

export function bindDeleteAction({
  container,
  buttonSelector,
  rowSelector,
  onDelete,
  onError
}) {
  if (!container) return;

  container.addEventListener("click", (event) => {
    const button = event.target.closest(buttonSelector);
    if (!button) return;
    const row = button.closest(rowSelector);
    if (!row) return;
    button.disabled = true;
    Promise.resolve(onDelete(row, button))
      .catch(onError)
      .finally(() => { button.disabled = false; });
  });
}
