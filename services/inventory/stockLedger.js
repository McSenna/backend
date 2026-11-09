"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const { notFound } = require("../../utils/AppError");
const { startOfDay } = require("../../utils/dateWindow");
const { runInTransaction, STOCK_TRANSACTION } = require("./transactionRunner");
const { SYSTEM_ACTOR, lockItem, recordMovements } = require("./movementRecorder");

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

const lapsedFilter = () => ({
  status: "active",
  expiryDate: { $ne: null, $lt: startOfDay(new Date()) },
});

const expiryLines = (lots, startingStock) => {
  let running = startingStock;
  return lots
    .filter((lot) => lot.quantityRemaining > 0)
    .map((lot) => {
      const previousStock = running;
      running = Math.max(0, running - lot.quantityRemaining);
      return {
        batch: lot._id,
        batchNumber: lot.batchNumber,
        type: "EXPIRED",
        quantity: lot.quantityRemaining,
        previousStock,
        newStock: running,
        reason: "Lot passed its expiry date",
        // One record per expiry of a lot, however many reads notice it at once.
        operationId: `expiry-${lot._id}-${new Date(lot.expiryDate).getTime()}`,
      };
    });
};

const expireItemLots = async (itemId, session) => {
  const item = await lockItem(itemId, session);
  const lots = await InventoryBatch.find({ ...lapsedFilter(), item: itemId })
    .sort({ expiryDate: 1, _id: 1 })
    .session(session)
    .lean();
  if (lots.length === 0) return;

  await InventoryBatch.updateMany({ _id: { $in: lots.map((lot) => lot._id) } }, { status: "expired" }, { session });

  // An expired lot no longer counts, so its item is recounted here. Marking the
  // lot alone left the list, summary and low-stock alerts counting it.
  const lines = expiryLines(lots, item.currentStock);
  if (lines.length > 0) await recordMovements({ item, lines, actor: SYSTEM_ACTOR, session });
  await recalculateItemStock(itemId, session);
};

const expireLapsedBatches = async (itemId = null, session = null) => {
  const filter = lapsedFilter();
  if (itemId) filter.item = itemId;

  const lapsedItems = InventoryBatch.distinct("item", filter);
  if (session) lapsedItems.session(session);
  const items = await lapsedItems;

  for (const id of items) {
    if (session) await expireItemLots(id, session);
    else await runInTransaction((own) => expireItemLots(id, own), STOCK_TRANSACTION);
  }
};

const getItemOrThrow = async (itemId, { includeInactive = false } = {}) => {
  const filter = { _id: itemId };
  if (!includeInactive) filter.isActive = true;

  const item = await InventoryItem.findOne(filter);
  if (!item) throw notFound("Inventory item not found.");
  return item;
};

module.exports = { recalculateItemStock, expireLapsedBatches, getItemOrThrow };
