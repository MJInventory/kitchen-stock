import ejs from "ejs";
import { join } from "node:path";
import { appReleaseLabel, appVersion } from "./app-config.js";

export function createViewHelpers(viewsDir) {
  function assetWithVersion(src = "") {
    const value = String(src || "").trim();
    if (!value) return value;
    const separator = value.includes("?") ? "&" : "?";
    return `${value}${separator}v=${encodeURIComponent(appVersion)}`;
  }

  async function renderPartial(partialName, data = {}) {
    return ejs.renderFile(join(viewsDir, "partials", `${partialName}.ejs`), data, { views: [viewsDir] });
  }

  function pageScripts(moduleSrc, { offline = false } = {}) {
    const scripts = ["/menu-config.js", "/menus.js", "/push.js", "/theme.js"].map(assetWithVersion);
    if (offline) scripts.push(assetWithVersion("/offline-queue.js"));
    if (moduleSrc) scripts.push({ src: assetWithVersion(moduleSrc), type: "module" });
    return scripts;
  }

  async function loginPartial(title, eyebrow = "Inventory", { numericPassword = false } = {}) {
    return renderPartial("login-screen", {
      eyebrow,
      title,
      appVersion,
      appReleaseLabel,
      ...(numericPassword ? { passwordInputMode: "numeric" } : {})
    });
  }

  function actionButton(href, label) {
    return `<a class="button secondary" href="${href}">${label}</a>`;
  }

  function actionLogout({ compact = false } = {}) {
    return compact
      ? '<button id="logoutButton" class="icon-button" type="button" title="Log out">Log Out</button>'
      : '<button id="logoutButton" class="secondary" type="button">Log Out</button>';
  }

  function actionUserChip() {
    return '<a id="currentUser" class="user-chip" href="/settings.html" hidden></a>';
  }

  function joinActions(actions) {
    return actions.filter(Boolean).join("\n");
  }

  function adminActions({ includeSetup = false } = {}) {
    return joinActions([
      actionUserChip(),
      includeSetup ? actionButton("/inventory-settings.html", "Setup") : "",
      actionButton("/", "Main Menu"),
      actionLogout()
    ]);
  }

  function sheetActions(links = []) {
    return joinActions([
      actionUserChip(),
      ...links.map((link) => actionButton(link.href, link.label)),
      actionLogout()
    ]);
  }

  function orderShellActions({ saveButtonId = "", saveButtonLabel = "", logoutCompact = true } = {}) {
    return joinActions([
      actionUserChip(),
      saveButtonId ? `<button id="${saveButtonId}" class="save-pill" type="button">${saveButtonLabel}</button>` : "",
      actionLogout({ compact: logoutCompact })
    ]);
  }

  return {
    renderPartial,
    assetWithVersion,
    pageScripts,
    loginPartial,
    actionButton,
    actionLogout,
    actionUserChip,
    joinActions,
    adminActions,
    sheetActions,
    orderShellActions
  };
}
