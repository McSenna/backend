"use strict";

const {
  INVENTORY_CATEGORIES,
  STORAGE_CONDITIONS,
} = require("../../models/InventoryItem");
const { isValidObjectId } = require("../../utils/objectId");

const STRING_FIELDS = [
  { key: "name", max: 160, required: true, label: "Item name" },
  { key: "specification", max: 120, label: "Specification" },
  { key: "genericName", max: 160, label: "Generic name" },
  { key: "description", max: 1000, label: "Description" },
  { key: "unit", max: 24, required: true, label: "Unit" },
];

const readItemPayload = (body, { partial = false } = {}) => {
  const payload = {};
  const errors = [];

  const setString = (key, value, { max, required = false, label }) => {
    if (value === undefined) {
      if (required && !partial) errors.push(`${label} is required`);
      return;
    }
    const text = String(value).trim();
    if (required && !text) {
      errors.push(`${label} is required`);
      return;
    }
    if (text.length > max) {
      errors.push(`${label} must be ${max} characters or fewer`);
      return;
    }
    payload[key] = text;
  };

  for (const field of STRING_FIELDS) {
    setString(field.key, body[field.key], field);
  }

  if (body.category !== undefined) {
    const category = String(body.category).trim().toLowerCase();
    if (!INVENTORY_CATEGORIES.includes(category)) errors.push("Category is not supported");
    else payload.category = category;
  } else if (!partial) {
    errors.push("Category is required");
  }

  if (body.reorderLevel !== undefined) {
    const reorderLevel = Number(body.reorderLevel);
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isInteger(reorderLevel)) {
      errors.push("Reorder level must be a whole number of zero or more");
    } else {
      payload.reorderLevel = reorderLevel;
    }
  } else if (!partial) {
    errors.push("Reorder level is required");
  }

  if (body.storageCondition !== undefined && String(body.storageCondition).trim()) {
    const storage = String(body.storageCondition).trim();
    if (!STORAGE_CONDITIONS.includes(storage)) errors.push("Storage condition is not supported");
    else payload.storageCondition = storage;
  }

  if (body.supplier !== undefined) {
    if (!body.supplier) payload.supplier = null;
    else if (!isValidObjectId(body.supplier)) errors.push("Supplier is not a valid reference");
    else payload.supplier = String(body.supplier);
  }

  return { payload, errors };
};

module.exports = { readItemPayload };
