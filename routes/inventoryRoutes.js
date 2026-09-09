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

const router = express.Router();

/**
 * Residents have no inventory access, so the whole module is gated to staff at
 * the router. The controller then applies the per-capability matrix — a BHW
 * reaches these routes but is refused an edit — so a role can never gain a
 * capability just by finding an endpoint.
 */
const staffOnly = roleCheck(["admin", "doctor", "midwife", "bhw"]);

// Fixed segments are declared before "/:id" so "summary" is never read as an id.
router.get("/inventory/summary", auth, staffOnly, getInventorySummary);
router.get("/inventory/alerts", auth, staffOnly, getInventoryAlerts);
router.get("/inventory/suppliers", auth, staffOnly, getSuppliers);

router.get("/inventory/items", auth, staffOnly, getInventoryItems);
router.post("/inventory/items", auth, staffOnly, createInventoryItem);

router.get("/inventory/items/:id", auth, staffOnly, getInventoryItem);
router.patch("/inventory/items/:id", auth, staffOnly, updateInventoryItem);
router.delete("/inventory/items/:id", auth, staffOnly, deactivateInventoryItem);

router.get("/inventory/items/:id/history", auth, staffOnly, getItemHistory);
router.post("/inventory/items/:id/stock-in", auth, staffOnly, addStock);
router.post("/inventory/items/:id/stock-out", auth, staffOnly, releaseStock);

module.exports = router;
