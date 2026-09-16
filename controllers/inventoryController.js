"use strict";

const { getInventoryItems, getInventoryItem } = require("./inventory/itemQueryController");
const {
  getInventorySummary,
  getInventoryAlerts,
} = require("./inventory/inventoryOverviewController");
const {
  createInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
} = require("./inventory/itemMutationController");
const { addStock, releaseStock } = require("./inventory/stockController");
const { getItemHistory, getSuppliers } = require("./inventory/historyController");
const { INVENTORY_PERMISSIONS, permissionsFor } = require("../config/inventoryPermissions");

module.exports = {
  getInventoryItems,
  getInventoryItem,
  getInventorySummary,
  getInventoryAlerts,
  createInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
  addStock,
  releaseStock,
  getItemHistory,
  getSuppliers,
  INVENTORY_PERMISSIONS,
  permissionsFor,
};
