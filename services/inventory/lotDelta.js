"use strict";

const InventoryBatch = require("../../models/InventoryBatch");
const { conflict, notFound } = require("../../utils/AppError");
const { startOfDay } = require("../../utils/dateWindow");

const isLapsed = (lot) =>
  lot.status === "expired" || Boolean(lot.expiryDate && startOfDay(lot.expiryDate) < startOfDay(new Date()));

const addToLot = (lot, quantity, session) => {
  if (isLapsed(lot)) {
    throw conflict(`Lot ${lot.batchNumber} has expired, so this quantity cannot go back into usable stock.`);
  }
  return InventoryBatch.updateOne(
    { _id: lot._id },
    { $inc: { quantityRemaining: quantity }, $set: { status: "active" } },
    { session }
  );
};

const removeFromLot = async (lot, quantity, session) => {
  if (lot.quantityRemaining < quantity) {
    throw conflict(`Lot ${lot.batchNumber} only has ${lot.quantityRemaining} left, so ${quantity} cannot be taken out of it.`);
  }
  const remaining = lot.quantityRemaining - quantity;
  return InventoryBatch.updateOne(
    { _id: lot._id, quantityRemaining: { $gte: quantity } },
    { $inc: { quantityRemaining: -quantity }, ...(remaining === 0 && lot.status === "active" ? { $set: { status: "depleted" } } : {}) },
    { session }
  );
};

// Positive adds to the lot, negative takes out. The caller holds the item lock and records the movement.
const applyLotDelta = async ({ batchId, delta, session }) => {
  const lot = await InventoryBatch.findById(batchId).session(session);
  if (!lot) throw notFound("That lot is no longer on record.");
  if (delta > 0) await addToLot(lot, delta, session);
  if (delta < 0) await removeFromLot(lot, -delta, session);
  return lot;
};

module.exports = { applyLotDelta, isLapsed };
