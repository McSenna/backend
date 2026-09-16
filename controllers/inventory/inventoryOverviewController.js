"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const {
  EXPIRY_THRESHOLDS,
  computeExpiryStatus,
  computeStockStatus,
  daysUntil,
  expireLapsedBatches,
  startOfDay,
} = require("../../services/inventoryService");
const { assertCan } = require("./inventory.access");

const DAY_MS = 24 * 60 * 60 * 1000;

const expiryWindow = () => {
  const today = startOfDay(new Date());
  return {
    today,
    soonCutoff: new Date(today.getTime() + EXPIRY_THRESHOLDS.soon * DAY_MS),
  };
};

const getInventorySummary = asyncHandler(async (req, res) => {
  assertCan(req, "view");
  await expireLapsedBatches();

  const { today, soonCutoff } = expiryWindow();
  const monthAgo = new Date(today.getTime() - 30 * DAY_MS);
  const active = { isActive: true };

  const [total, inStock, lowStock, outOfStock, expiringSoon, expired, totalLastMonth] =
    await Promise.all([
      InventoryItem.countDocuments(active),
      InventoryItem.countDocuments({
        ...active,
        $expr: { $gt: ["$currentStock", "$reorderLevel"] },
      }),
      InventoryItem.countDocuments({
        ...active,
        $expr: {
          $and: [{ $gt: ["$currentStock", 0] }, { $lte: ["$currentStock", "$reorderLevel"] }],
        },
      }),
      InventoryItem.countDocuments({ ...active, currentStock: { $lte: 0 } }),
      InventoryItem.countDocuments({
        ...active,
        nearestExpiry: { $gte: today, $lte: soonCutoff },
      }),
      InventoryItem.countDocuments({ ...active, nearestExpiry: { $ne: null, $lt: today } }),
      InventoryItem.countDocuments({ ...active, createdAt: { $lt: monthAgo } }),
    ]);

  const growth =
    totalLastMonth > 0 ? Math.round(((total - totalLastMonth) / totalLastMonth) * 100) : null;

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory summary loaded successfully.",
    summary: {
      total: { value: total, growth },
      inStock: { value: inStock, growth: null },
      lowStock: { value: lowStock, growth: null },
      expiringSoon: { value: expiringSoon, growth: null },
      outOfStock: { value: outOfStock, growth: null },
      expired: { value: expired, growth: null },
    },
  });
});

const toStockAlert = (item) => ({
  itemId: String(item._id),
  name: item.name,
  specification: item.specification || "",
  currentStock: item.currentStock,
  reorderLevel: item.reorderLevel,
  unit: item.unit,
  status: computeStockStatus(item.currentStock, item.reorderLevel),
});

const toExpiryAlert = (batch) => ({
  itemId: String(batch.item._id),
  name: batch.item.name,
  specification: batch.item.specification || "",
  unit: batch.item.unit,
  batchNumber: batch.batchNumber,
  expiryDate: batch.expiryDate,
  quantityRemaining: batch.quantityRemaining,
  daysUntilExpiry: daysUntil(batch.expiryDate),
  status: computeExpiryStatus(batch.expiryDate),
});

const getInventoryAlerts = asyncHandler(async (req, res) => {
  assertCan(req, "view");
  await expireLapsedBatches();

  const { soonCutoff } = expiryWindow();

  const [lowOrOut, expiring] = await Promise.all([
    InventoryItem.find({ isActive: true, $expr: { $lte: ["$currentStock", "$reorderLevel"] } })
      .sort({ currentStock: 1 })
      .limit(50)
      .lean(),
    InventoryBatch.find({
      status: "active",
      quantityRemaining: { $gt: 0 },
      expiryDate: { $ne: null, $lte: soonCutoff },
    })
      .sort({ expiryDate: 1 })
      .limit(50)
      .populate("item", "name specification unit isActive")
      .lean(),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory alerts loaded successfully.",
    alerts: {
      stock: lowOrOut.map(toStockAlert),
      expiry: expiring
        .filter((batch) => batch.item && batch.item.isActive !== false)
        .map(toExpiryAlert),
    },
  });
});

module.exports = { getInventorySummary, getInventoryAlerts };
