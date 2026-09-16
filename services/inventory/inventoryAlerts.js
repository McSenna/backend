"use strict";

const Notification = require("../../models/Notification");
const User = require("../../models/User");
const logger = require("../../utils/logger");
const { computeStockStatus, daysUntil } = require("./stockStatus");

const ALERT_ROLES = ["admin"];

const itemLabel = (item) =>
  `${item.name}${item.specification ? ` (${item.specification})` : ""}`;

const loadAlertRecipients = () =>
  User.find({ role: { $in: ALERT_ROLES }, verified: true }).select("_id").lean();

const fanOut = async (recipients, content) => {
  await Notification.insertMany(
    recipients.map((user) => ({ recipient: user._id, ...content }))
  );
};

const stockAlertContent = (item, kind) =>
  kind === "out-of-stock"
    ? {
        type: "inventory_out_of_stock",
        title: "Out of Stock",
        body: `${itemLabel(item)} is out of stock. Current stock: 0 ${item.unit}.`,
        tone: "warning",
      }
    : {
        type: "inventory_low_stock",
        title: "Low Stock Alert",
        body: `${itemLabel(item)} is below its reorder level. Current stock: ${item.currentStock} ${item.unit}, reorder level: ${item.reorderLevel} ${item.unit}.`,
        tone: "warning",
      };

const notifyStockAlert = async (item, kind) => {
  try {
    const recipients = await loadAlertRecipients();
    if (!recipients.length) return;
    await fanOut(recipients, stockAlertContent(item, kind));
  } catch (error) {
    logger.warn("Failed to write inventory stock alert", { errorName: error?.name });
  }
};

const notifyExpiryAlert = async (item, batch) => {
  try {
    const recipients = await loadAlertRecipients();
    if (!recipients.length) return;

    const remaining = daysUntil(batch.expiryDate);

    await fanOut(recipients, {
      type: "inventory_expiring",
      title: "Stock Expiring Soon",
      body: `${itemLabel(item)} — batch ${batch.batchNumber} expires in ${remaining} day${remaining === 1 ? "" : "s"}. ${batch.quantityRemaining} ${item.unit} remaining.`,
      tone: "warning",
    });
  } catch (error) {
    logger.warn("Failed to write inventory expiry alert", { errorName: error?.name });
  }
};

const evaluateStockAlerts = async (item) => {
  if (!item) return;
  const status = computeStockStatus(item.currentStock, item.reorderLevel);
  if (status === "out-of-stock") await notifyStockAlert(item, "out-of-stock");
  else if (status === "low-stock") await notifyStockAlert(item, "low-stock");
};

module.exports = { notifyStockAlert, notifyExpiryAlert, evaluateStockAlerts };
