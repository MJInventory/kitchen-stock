import test from "node:test";
import assert from "node:assert/strict";

import { createDriverSheetActions } from "../public/driver-sheet/actions.js";
import { renderSheet } from "../public/driver-sheet/render.js";

test("driver sheet shows the saved memo below its supplier", () => {
  const elements = {
    driverName: { value: "" },
    printDate: { textContent: "" },
    printDriver: { textContent: "" },
    sheetList: { innerHTML: "" }
  };

  const currentSheet = renderSheet({
    date: "2026-07-29",
    requests: [{
      id: "request-1",
      driverLineId: "line-1",
      itemName: "Limes",
      supplierName: "Fresh Supplier",
      category: "Produce",
      quantity: 2,
      unit: "box"
    }],
    suppliers: [],
    supplierNotes: [{
      supplierName: "Fresh Supplier",
      memo: "Use the side entrance"
    }]
  }, elements);

  assert.equal(currentSheet.supplierNotes.length, 1);
  assert.match(elements.sheetList.innerHTML, /driver-supplier-memo-input/);
  assert.match(elements.sheetList.innerHTML, /value="Use the side entrance"/);
  assert.ok(
    elements.sheetList.innerHTML.indexOf("driver-supplier-memo") <
      elements.sheetList.innerHTML.indexOf("driver-supplier-title")
  );
});

test("driver sheet memo autosave updates the shared supplier note", async () => {
  const calls = [];
  const messages = [];
  const currentSheet = {
    supplierNotes: [{ supplierName: "Fresh Supplier", memo: "Old memo" }]
  };
  const input = {
    value: "Call before arrival",
    disabled: false,
    dataset: {
      supplierName: "Fresh Supplier",
      savedValue: "Old memo"
    }
  };
  const actions = createDriverSheetActions({
    api: async (path, options) => {
      calls.push({ path, options });
      return {
        note: {
          supplierName: "Fresh Supplier",
          memo: "Call before arrival"
        }
      };
    },
    setMessage: (...args) => messages.push(args),
    renderCurrentSheet: () => {},
    loadSheet: async () => {},
    chooseSupplierChangeMode: async () => null
  });

  await actions.saveSupplierMemo(input, currentSheet, "2026-07-29");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/receiving-notes");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    date: "2026-07-29",
    supplierName: "Fresh Supplier",
    memo: "Call before arrival"
  });
  assert.equal(input.dataset.savedValue, "Call before arrival");
  assert.equal(currentSheet.supplierNotes[0].memo, "Call before arrival");
  assert.deepEqual(messages.at(-1), ["Supplier memo saved."]);
});
