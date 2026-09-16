"use strict";

const { INCREASING_TYPES } = require("../models/InventoryTransaction");
const { startOfDay } = require("../utils/dateWindow");
const {
  EXPIRY_THRESHOLDS,
  computeStockStatus,
  computeExpiryStatus,
  daysUntil,
} = require("./inventory/stockStatus");
const {
  recalculateItemStock,
  expireLapsedBatches,
  getItemOrThrow,
} = require("./inventory/stockLedger");
const { runInTransaction } = require("./inventory/transactionRunner");
const { planFefoAllocation, allocateAndDecrement } = require("./inventory/fefoAllocator");
const { stockIn } = require("./inventory/stockInService");
const { stockOut } = require("./inventory/stockOutService");
const { dispenseItems } = require("./inventory/dispenseService");
const { evaluateStockAlerts, notifyExpiryAlert } = require("./inventory/inventoryAlerts");

module.exports = {
  EXPIRY_THRESHOLDS,
  computeStockStatus,
  computeExpiryStatus,
  daysUntil,
  startOfDay,
  recalculateItemStock,
  expireLapsedBatches,
  planFefoAllocation,
  runInTransaction,
  allocateAndDecrement,
  stockIn,
  stockOut,
  dispenseItems,
  evaluateStockAlerts,
  notifyExpiryAlert,
  getItemOrThrow,
  INCREASING_TYPES,
};
