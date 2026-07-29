import test from "node:test";
import assert from "node:assert/strict";

import { buildPlainTextSheet } from "../public/driver-sheet/helpers.js";

test("supplier text excludes items already marked as ordered", () => {
  const text = buildPlainTextSheet([
    {
      supplierName: "Pepia Est N.V.",
      itemName: "Absolut 1L",
      quantity: 1,
      unit: "box",
      ordered: true
    },
    {
      supplierName: "Pepia Est N.V.",
      itemName: "Fee Foamer",
      quantity: 2,
      unit: "box",
      ordered: false
    },
    {
      supplierName: "Another Supplier",
      itemName: "Other Item",
      quantity: 3,
      unit: "item",
      ordered: false
    }
  ], "Pepia Est N.V.");

  assert.doesNotMatch(text, /Absolut 1L/);
  assert.match(text, /2 x box Fee Foamer/);
  assert.doesNotMatch(text, /Other Item/);
});

test("supplier text is empty when every matching item is already ordered", () => {
  const text = buildPlainTextSheet([
    {
      supplierName: "Pepia Est N.V.",
      itemName: "Kahlua",
      quantity: 1,
      unit: "box",
      ordered: true
    }
  ], "Pepia Est N.V.");

  assert.equal(text, "");
});
