"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const { notFound } = require("../../utils/AppError");
const { startOfDay } = require("../../utils/dateWindow");

const recalculateItemStock = async (itemId, session = null) => {
  const now = new Date();

  const query = InventoryBatch.find({ item: itemId, status: { $in: ["active", "expired"] } })
    .select("quantityRemaining expiryDate status")
    .lean();
  if (session) query.session(session);
  const batches = await query;

  let currentStock = 0;
  let nearestExpiry = null;

  for (const batch of batches) {
    const isExpired = batch.expiryDate && startOfDay(batch.expiryDate) < startOfDay(now);
    if (isExpired || batch.status !== "active") continue;

    currentStock += batch.quantityRemaining;

    if (batch.expiryDate && batch.quantityRemaining > 0) {
      if (!nearestExpiry || batch.expiryDate < nearestExpiry) nearestExpiry = batch.expiryDate;
    }
  }

  const update = InventoryItem.findByIdAndUpdate(
    itemId,
    { currentStock, nearestExpiry },
    { returnDocument: "after" }
  );
  if (session) update.session(session);
  return update;
};

const expireLapsedBatches = (itemId = null, session = null) => {
  const filter = {
    status: "active",
    expiryDate: { $ne: null, $lt: startOfDay(new Date()) },
  };
  if (itemId) filter.item = itemId;

  const query = InventoryBatch.updateMany(filter, { status: "expired" });
  if (session) query.session(session);
  return query;
};

const getItemOrThrow = async (itemId, { includeInactive = false } = {}) => {
  const filter = { _id: itemId };
  if (!includeInactive) filter.isActive = true;

  const item = await InventoryItem.findOne(filter);
  if (!item) throw notFound("Inventory item not found.");
  return item;
};

module.exports = { recalculateItemStock, expireLapsedBatches, getItemOrThrow };
