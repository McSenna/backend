"use strict";

const { RESIDENCY } = require("./residency");

// Inventory has one stockroom today, so this is where stock leaves from and arrives at.
const FACILITY_NAME = `Barangay ${RESIDENCY.barangay} Health Center`;

const SYSTEM_ACTOR_NAME = "System";

// A release to someone: the stock is handed over, but nothing confirms receipt yet.
const ISSUE_TYPES = ["STOCK_OUT", "TRANSFER"];

// The five groups the history filters and cards use, mapped to the stored types.
const MOVEMENT_GROUPS = {
  stock_in: ["STOCK_IN"],
  stock_out: ["STOCK_OUT"],
  transfer: ["TRANSFER"],
  return: ["RETURNED"],
  adjustment: ["ADJUSTMENT", "DAMAGED", "EXPIRED"],
  // What the "released" card counts, so tapping it lists the same rows.
  released: ["STOCK_OUT", "TRANSFER"],
};

const groupOfType = (type) =>
  Object.keys(MOVEMENT_GROUPS).find((group) => MOVEMENT_GROUPS[group].includes(type)) || "adjustment";

const RETURN_CONDITIONS = ["usable", "damaged", "expired", "contaminated"];

const ADJUSTMENT_CATEGORIES = {
  physical_count: "Physical count",
  lost: "Lost or missing",
  manual: "Manual correction",
};

// How a row relates to an earlier one. Opening rows carry a balance from before tracking began.
const MOVEMENT_RELATIONS = ["return", "reversal", "opening"];

module.exports = {
  FACILITY_NAME,
  SYSTEM_ACTOR_NAME,
  ISSUE_TYPES,
  MOVEMENT_GROUPS,
  groupOfType,
  RETURN_CONDITIONS,
  ADJUSTMENT_CATEGORIES,
  MOVEMENT_RELATIONS,
};
