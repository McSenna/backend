"use strict";

const InventoryBatch = require("../../models/InventoryBatch");
const { conflict, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { startOfDay } = require("../../utils/dateWindow");
const { recalculateItemStock, expireLapsedBatches } = require("./stockLedger");

const planFefoAllocation = (batches, quantity) => {
  let remaining = quantity;
  const plan = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    if (batch.quantityRemaining <= 0) continue;

    const take = Math.min(batch.quantityRemaining, remaining);
    plan.push({ batch, quantity: take });
    remaining -= take;
  }

  return { plan, shortfall: remaining };
};

const byExpiryThenReceipt = (a, b) => {
  if (a.expiryDate && b.expiryDate) {
    const diff = a.expiryDate - b.expiryDate;
    if (diff !== 0) return diff;
  } else if (a.expiryDate) {
    return -1;
  } else if (b.expiryDate) {
    return 1;
  }
  return new Date(a.receivedDate || 0) - new Date(b.receivedDate || 0);
};

const loadReleasableBatches = async (itemId, session) => {
  const batchQuery = InventoryBatch.find({
    item: itemId,
    status: "active",
    quantityRemaining: { $gt: 0 },
    $or: [{ expiryDate: null }, { expiryDate: { $gte: startOfDay(new Date()) } }],
  });
  if (session) batchQuery.session(session);
  return (await batchQuery).sort(byExpiryThenReceipt);
};

const assertSufficientStock = (refreshed, quantity) => {
  if (!refreshed) throw notFound("Inventory item not found.");

  if (refreshed.currentStock <= 0) {
    throw conflict(
      `${refreshed.name} is out of stock and cannot be released.`,
      ERROR_CODES.CONFLICT
    );
  }
  if (quantity > refreshed.currentStock) {
    throw conflict(
      `Only ${refreshed.currentStock} ${refreshed.unit} of ${refreshed.name} available. Requested quantity: ${quantity}.`,
      ERROR_CODES.CONFLICT
    );
  }
};

const decrementBatch = async ({ step, refreshed, runningStock, session }) => {
  const applied = await InventoryBatch.findOneAndUpdate(
    { _id: step.batch._id, quantityRemaining: { $gte: step.quantity }, status: "active" },
    { $inc: { quantityRemaining: -step.quantity } },
    { returnDocument: "after", session }
  );

  if (!applied) {
    throw conflict(
      `${refreshed.name} was just released by someone else. Please review the item and try again.`,
      ERROR_CODES.CONFLICT
    );
  }

  if (applied.quantityRemaining === 0) {
    await InventoryBatch.findByIdAndUpdate(applied._id, { status: "depleted" }, { session });
  }

  return {
    batch: applied._id,
    batchNumber: applied.batchNumber,
    expiryDate: applied.expiryDate || null,
    quantity: step.quantity,
    previousStock: runningStock,
    newStock: runningStock - step.quantity,
  };
};

const allocateAndDecrement = async ({ itemId, quantity, session = null }) => {
  await expireLapsedBatches(itemId, session);
  const refreshed = await recalculateItemStock(itemId, session);

  assertSufficientStock(refreshed, quantity);

  const batches = await loadReleasableBatches(itemId, session);
  const { plan, shortfall } = planFefoAllocation(batches, quantity);

  if (shortfall > 0) {
    throw conflict(
      `Not enough unexpired stock of ${refreshed.name} is available to cover this release.`,
      ERROR_CODES.CONFLICT
    );
  }

  const previousStock = refreshed.currentStock;
  const allocations = [];
  let runningStock = previousStock;

  for (const step of plan) {
    const allocation = await decrementBatch({ step, refreshed, runningStock, session });
    allocations.push(allocation);
    runningStock = allocation.newStock;
  }

  const updatedItem = await recalculateItemStock(itemId, session);

  return { item: updatedItem, previousStock, newStock: runningStock, allocations };
};

module.exports = { planFefoAllocation, allocateAndDecrement };
