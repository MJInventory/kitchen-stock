(function () {
  const fallbackKey = "kitchenStockTheme";

  function userName() {
    return localStorage.getItem("kitchenStockUser") || document.querySelector("#currentUser")?.textContent || "";
  }

  function themeKey() {
    const user = userName().trim().toLowerCase();
    return user ? `${fallbackKey}:${user}` : fallbackKey;
  }

  function currentTheme() {
    return localStorage.getItem(themeKey()) || localStorage.getItem(fallbackKey) || "dark";
  }

  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalized;
    localStorage.setItem(themeKey(), normalized);
    localStorage.setItem(fallbackKey, normalized);
    const select = document.querySelector("#themeSelect");
    if (select) select.value = normalized;
  }

  function injectControl() {
    if (document.querySelector("#themeSelect")) return;

    const control = document.createElement("label");
    control.className = "theme-control no-print";
    control.innerHTML = `
      <span>Theme</span>
      <select id="themeSelect" aria-label="Theme">
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    `;

    const target = document.querySelector(".top-actions") || document.querySelector(".order-topbar") || document.body;
    target.prepend(control);

    document.querySelector("#themeSelect").addEventListener("change", (event) => {
      applyTheme(event.target.value);
    });
    applyTheme(currentTheme());
  }

  applyTheme(currentTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectControl);
  } else {
    injectControl();
  }

  const currentUser = document.querySelector("#currentUser");
  if (currentUser) {
    new MutationObserver(() => applyTheme(currentTheme())).observe(currentUser, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
})();
