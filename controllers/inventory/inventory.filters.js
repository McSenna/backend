"use strict";

const InventoryBatch = require("../../models/InventoryBatch");
const { INVENTORY_CATEGORIES } = require("../../models/InventoryItem");
const Supplier = require("../../models/Supplier");
const { EXPIRY_THRESHOLDS, startOfDay } = require("../../services/inventoryService");

const SORT_FIELDS = {
  updated_desc: { updatedAt: -1 },
  updated_asc: { updatedAt: 1 },
  name_asc: { name: 1 },
  name_desc: { name: -1 },
  stock_asc: { currentStock: 1 },
  stock_desc: { currentStock: -1 },
  expiry_asc: { nearestExpiry: 1 },
  expiry_desc: { nearestExpiry: -1 },
};

function buildStockStatusFilter(stockStatus) {
  switch (stockStatus) {
    case "out-of-stock":
      return { currentStock: { $lte: 0 } };
    case "low-stock":
      return {
        $expr: {
          $and: [{ $gt: ["$currentStock", 0] }, { $lte: ["$currentStock", "$reorderLevel"] }],
        },
      };
    case "in-stock":
      return { $expr: { $gt: ["$currentStock", "$reorderLevel"] } };
    default:
      return null;
  }
}

function buildExpiryStatusFilter(expiryStatus, now = new Date()) {
  const today = startOfDay(now);
  const addDays = (days) => new Date(today.getTime() + days * 24 * 60 * 60 * 1000);

  switch (expiryStatus) {
    case "none":
      return { nearestExpiry: null };
    case "expired":
      return { nearestExpiry: { $ne: null, $lt: today } };
    case "urgent":
      return { nearestExpiry: { $gte: today, $lte: addDays(EXPIRY_THRESHOLDS.urgent) } };
    case "expiring-soon":
      return { nearestExpiry: { $gte: today, $lte: addDays(EXPIRY_THRESHOLDS.soon) } };
    case "normal":
      return { nearestExpiry: { $gt: addDays(EXPIRY_THRESHOLDS.soon) } };
    default:
      return null;
  }
}

async function buildListFilter(query) {
  const { search = "", category = "all", stockStatus = "all", expiryStatus = "all" } = query;

  const conditions = [{ isActive: true }];

  const term = String(search || "").trim();
  if (term) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(safe, "i");

    const [batches, suppliers] = await Promise.all([
      InventoryBatch.find({ batchNumber: pattern }).select("item").lean(),
      Supplier.find({ name: pattern }).select("_id").lean(),
    ]);

    conditions.push({
      $or: [
        { name: pattern },
        { genericName: pattern },
        { specification: pattern },
        { description: pattern },
        { category: pattern },
        { unit: pattern },
        ...(batches.length ? [{ _id: { $in: batches.map((b) => b.item) } }] : []),
        ...(suppliers.length ? [{ supplier: { $in: suppliers.map((s) => s._id) } }] : []),
      ],
    });
  }

  if (category !== "all" && INVENTORY_CATEGORIES.includes(String(category))) {
    conditions.push({ category: String(category) });
  }

  const stockFilter = buildStockStatusFilter(String(stockStatus));
  if (stockFilter) conditions.push(stockFilter);

  const expiryFilter = buildExpiryStatusFilter(String(expiryStatus));
  if (expiryFilter) conditions.push(expiryFilter);

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

module.exports = { SORT_FIELDS, buildStockStatusFilter, buildExpiryStatusFilter, buildListFilter };
