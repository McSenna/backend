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

  // Writes only a real change. The item detail read recalculates too, and an
  // unconditional write bumped updatedAt on every view: the realtime update
  // made each open details panel reload, which wrote again, without end.
  const update = InventoryItem.findOneAndUpdate(
    { _id: itemId, $or: [{ currentStock: { $ne: currentStock } }, { nearestExpiry: { $ne: nearestExpiry } }] },
    { currentStock, nearestExpiry },
    { returnDocument: "after" }
  );
  if (session) update.session(session);
  const changed = await update;
  if (changed) return changed;

  const unchanged = InventoryItem.findById(itemId);
  if (session) unchanged.session(session);
  return unchanged;
};

const expireLapsedBatches = async (itemId = null, session = null) => {
  const filter = {
    status: "active",
    expiryDate: { $ne: null, $lt: startOfDay(new Date()) },
  };
  if (itemId) filter.item = itemId;

  const lapsedItems = InventoryBatch.distinct("item", filter);
  if (session) lapsedItems.session(session);
  const items = await lapsedItems;
  if (items.length === 0) return;

  const expire = InventoryBatch.updateMany({ ...filter, item: { $in: items } }, { status: "expired" });
  if (session) expire.session(session);
  await expire;

  // An expired lot no longer counts, so its item is recounted here. Marking the
  // lot alone left the list, summary and low-stock alerts counting it.
  for (const id of items) await recalculateItemStock(id, session);
};

const getItemOrThrow = async (itemId, { includeInactive = false } = {}) => {
  const filter = { _id: itemId };
  if (!includeInactive) filter.isActive = true;

  const item = await InventoryItem.findOne(filter);
  if (!item) throw notFound("Inventory item not found.");
  return item;
};

module.exports = { recalculateItemStock, expireLapsedBatches, getItemOrThrow };
