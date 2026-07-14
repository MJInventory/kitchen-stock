import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

import { bindAutosaveRows } from "../public/admin-crud-helpers.js";

async function loadScreenAccess() {
  const context = { window: {} };
  const menuSource = await fs.readFile(new URL("../public/menu-config.js", import.meta.url), "utf8");
  const accessSource = await fs.readFile(new URL("../public/screen-access.js", import.meta.url), "utf8");
  vm.runInNewContext(menuSource, context);
  vm.runInNewContext(accessSource, context);
  return {
    access: context.window.MJScreenAccess,
    config: context.window.MJ_STOCK_MENU_ITEMS
  };
}

test("Item Admin access consistently covers its child administration screens", async () => {
  const { access, config } = await loadScreenAccess();
  const match = access.findItemForPath("/units-of-measure.html", config);
  assert.equal(match.item.href, "/inventory-settings.html");
  assert.equal(match.section, "backoffice");
  assert.equal(access.isPathAllowed(
    "/units-of-measure.html",
    config,
    { canAddInventoryItems: true },
    { blockedBackofficeMenu: ["/inventory-settings.html"] }
  ), false);
});

test("screen access applies permissions and God restrictions through one decision", async () => {
  const { access, config } = await loadScreenAccess();
  assert.equal(access.isPathAllowed("/standing-orders.html", config, {}, {}), false);
  assert.equal(access.isPathAllowed(
    "/standing-orders.html",
    config,
    { canAddInventoryItems: true },
    { blockedBackofficeMenu: ["/standing-orders.html"] }
  ), false);
  assert.equal(access.isPathAllowed(
    "/standing-orders.html",
    config,
    { canAddInventoryItems: true },
    {}
  ), true);
});

function eventTargetHarness() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type, event) {
      return listeners.get(type)?.(event);
    }
  };
}

test("autosave tracks dirty rows, queues a save on row exit, and clears navigation warning", async () => {
  const container = eventTargetHarness();
  const windowObject = eventTargetHarness();
  let dirty = false;
  let saves = 0;
  const row = {
    classList: { toggle() {} },
    contains: () => false
  };
  const input = { closest: () => row };
  const binding = bindAutosaveRows({
    container,
    rowSelector: ".row",
    isDirty: () => dirty,
    saveRow: async () => {
      saves += 1;
      dirty = false;
    },
    windowObject
  });

  dirty = true;
  container.dispatch("input", { target: input });
  const blockedNavigation = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: null };
  windowObject.dispatch("beforeunload", blockedNavigation);
  assert.equal(blockedNavigation.prevented, true);

  container.dispatch("focusout", { target: input, relatedTarget: null });
  await binding.flushRow(row);
  assert.equal(saves, 1);
  const allowedNavigation = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: null };
  windowObject.dispatch("beforeunload", allowedNavigation);
  assert.equal(allowedNavigation.prevented, false);
  binding.dispose();
});
