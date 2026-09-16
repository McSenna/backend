"use strict";

const { isValidObjectId } = require("./objectId");

const MAX_DISTINCT_ITEMS = 40;

const MAX_QUANTITY_PER_ITEM = 10000;

function validateDispenseInput(raw) {
  const errors = [];

  if (raw === undefined || raw === null) return { ok: true, errors, value: [] };

  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["Medicines and supplies must be sent as a list."], value: [] };
  }

  const merged = new Map();

  raw.forEach((entry, index) => {
    const position = index + 1;
    const line = entry && typeof entry === "object" ? entry : {};
    const itemId = String(line.inventoryItemId ?? line.itemId ?? "").trim();

    if (!itemId) {
      errors.push(`Item ${position} is missing which inventory item was given.`);
      return;
    }
    if (!isValidObjectId(itemId)) {
      errors.push(`Item ${position} does not refer to a valid inventory item.`);
      return;
    }

    const rawQuantity = line.quantity;
    if (rawQuantity === undefined || rawQuantity === null || rawQuantity === "") {
      errors.push(`Enter a quantity for item ${position}.`);
      return;
    }

    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity)) {
      errors.push(`The quantity for item ${position} must be a number.`);
      return;
    }
   
    if (!Number.isInteger(quantity)) {
      errors.push(`The quantity for item ${position} must be a whole number.`);
      return;
    }
    if (quantity <= 0) {
      errors.push(`The quantity for item ${position} must be greater than zero.`);
      return;
    }

    const runningTotal = (merged.get(itemId) || 0) + quantity;
    if (runningTotal > MAX_QUANTITY_PER_ITEM) {
      errors.push(`The quantity for item ${position} is too large.`);
      return;
    }

    merged.set(itemId, runningTotal);
  });

  if (merged.size > MAX_DISTINCT_ITEMS) {
    errors.push(`A visit can record at most ${MAX_DISTINCT_ITEMS} different medicines or supplies.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    value: Array.from(merged, ([itemId, quantity]) => ({ itemId, quantity })),
  };
}

module.exports = { validateDispenseInput, MAX_DISTINCT_ITEMS, MAX_QUANTITY_PER_ITEM };
