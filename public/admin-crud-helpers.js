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
  onError,
  windowObject = window
}) {
  if (!container) return { dispose() {}, flushRow: async () => {} };
  const dirtyRows = new Set();
  const pendingRows = new WeakMap();

  function syncRowState(row) {
    if (!row) return;
    const dirty = Boolean(isDirty(row));
    row.classList.toggle("dirty", dirty);
    if (dirty) dirtyRows.add(row);
    else dirtyRows.delete(row);
  }

  function flushRow(row) {
    if (!row) return Promise.resolve();
    const previous = pendingRows.get(row) || Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(() => isDirty(row) ? saveRow(row) : undefined)
      .then(() => syncRowState(row));
    pendingRows.set(row, pending);
    pending
      .catch((error) => onError?.(error))
      .finally(() => {
        if (pendingRows.get(row) === pending) pendingRows.delete(row);
      });
    return pending;
  }

  const handleInput = (event) => {
    syncRowState(event.target.closest(rowSelector));
  };

  const handleChange = (event) => {
    syncRowState(event.target.closest(rowSelector));
  };

  const handleFocusOut = (event) => {
    const row = event.target.closest(rowSelector);
    if (!row) return;
    const next = event.relatedTarget;
    if (next && row.contains(next)) return;
    void flushRow(row);
  };

  const handleBeforeUnload = (event) => {
    if (!dirtyRows.size) return;
    event.preventDefault();
    event.returnValue = "";
  };

  container.addEventListener("input", handleInput);
  container.addEventListener("change", handleChange);
  container.addEventListener("focusout", handleFocusOut);
  windowObject?.addEventListener?.("beforeunload", handleBeforeUnload);

  return {
    flushRow,
    dispose() {
      container.removeEventListener?.("input", handleInput);
      container.removeEventListener?.("change", handleChange);
      container.removeEventListener?.("focusout", handleFocusOut);
      windowObject?.removeEventListener?.("beforeunload", handleBeforeUnload);
      dirtyRows.clear();
    }
  };
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
