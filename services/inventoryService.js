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
const { returnStock } = require("./inventory/stockReturnService");
const { reverseMovement } = require("./inventory/stockReversalService");
const { adjustLot } = require("./inventory/stockAdjustmentService");
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
  returnStock,
  reverseMovement,
  adjustLot,
  evaluateStockAlerts,
  notifyExpiryAlert,
  getItemOrThrow,
  INCREASING_TYPES,
};
