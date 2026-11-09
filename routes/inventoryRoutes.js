"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
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
} = require("../controllers/inventoryController");
const { requireInventory } = require("../controllers/inventory/inventory.access");
const { adminExportLimiter } = require("../middleware/adminRateLimiter");
const { getMovements, getMovementSummary, getMovementFilters, getMovement } = require("../controllers/inventory/movementController");
const { exportMovements } = require("../controllers/inventory/movementExportController");
const { recordReturn, reverse, correctCount } = require("../controllers/inventory/correctionController");

const router = express.Router();

const staffOnly = roleCheck(["admin", "doctor", "midwife", "bhw"]);

// Every write names its capability here and again in its handler; admins hold none of them.

router.get("/inventory/summary", auth, staffOnly, getInventorySummary);
router.get("/inventory/alerts", auth, staffOnly, getInventoryAlerts);
router.get("/inventory/suppliers", auth, staffOnly, getSuppliers);

// The facility-wide history. Static paths come before ":id".
const ledger = [auth, staffOnly, requireInventory("ledger")];
router.get("/inventory/movements", ledger, getMovements);
router.get("/inventory/movements/summary", ledger, getMovementSummary);
router.get("/inventory/movements/filters", ledger, getMovementFilters);
router.get("/inventory/movements/export", ledger, adminExportLimiter, exportMovements);
router.get("/inventory/movements/:id", ledger, getMovement);

router.get("/inventory/items", auth, staffOnly, getInventoryItems);
router.post("/inventory/items", auth, staffOnly, requireInventory("create"), createInventoryItem);

router.get("/inventory/items/:id", auth, staffOnly, getInventoryItem);
router.patch("/inventory/items/:id", auth, staffOnly, requireInventory("edit"), updateInventoryItem);
router.delete("/inventory/items/:id", auth, staffOnly, requireInventory("deactivate"), deactivateInventoryItem);

router.get("/inventory/items/:id/history", auth, staffOnly, getItemHistory);
router.post("/inventory/items/:id/stock-in", auth, staffOnly, requireInventory("stockIn"), addStock);
router.post("/inventory/items/:id/stock-out", auth, staffOnly, requireInventory("stockOut"), releaseStock);

const correction = [auth, staffOnly, requireInventory("correct")];
router.post("/inventory/items/:id/adjust", correction, correctCount);
router.post("/inventory/movements/:id/return", correction, recordReturn);
router.post("/inventory/movements/:id/reverse", correction, reverse);

module.exports = router;
