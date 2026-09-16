"use strict";

const { DAY_MS, startOfDay } = require("../../utils/dateWindow");

const EXPIRY_THRESHOLDS = {
  urgent: Number(process.env.INVENTORY_URGENT_EXPIRY_DAYS) || 30,
  soon: Number(process.env.INVENTORY_EXPIRING_SOON_DAYS) || 90,
};

const computeStockStatus = (currentStock, reorderLevel) => {
  const stock = Number(currentStock) || 0;
  const reorder = Number(reorderLevel) || 0;
  if (stock <= 0) return "out-of-stock";
  if (stock <= reorder) return "low-stock";
  return "in-stock";
};

const computeExpiryStatus = (expiryDate, now = new Date()) => {
  if (!expiryDate) return "none";

  const expiry = startOfDay(expiryDate).getTime();
  const today = startOfDay(now).getTime();

  if (expiry < today) return "expired";

  const daysRemaining = Math.round((expiry - today) / DAY_MS);
  if (daysRemaining <= EXPIRY_THRESHOLDS.urgent) return "urgent";
  if (daysRemaining <= EXPIRY_THRESHOLDS.soon) return "expiring-soon";
  return "normal";
};

const daysUntil = (expiryDate, now = new Date()) => {
  if (!expiryDate) return null;
  return Math.round((startOfDay(expiryDate).getTime() - startOfDay(now).getTime()) / DAY_MS);
};

module.exports = { EXPIRY_THRESHOLDS, computeStockStatus, computeExpiryStatus, daysUntil };
