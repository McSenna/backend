"use strict";

const InventoryTransaction = require("../../models/InventoryTransaction");
const { badRequest } = require("../../utils/AppError");
const { runInTransaction } = require("./transactionRunner");
const { allocateAndDecrement } = require("./fefoAllocator");
const { readQuantity } = require("./stockValidation");

const stockOut = async ({ item, payload, actor }) => {
  const quantity = readQuantity(payload.quantity);

  if (!String(payload.reason || "").trim()) {
    throw badRequest("A reason for the release is required.");
  }

  return runInTransaction(async (session) => {
    const { item: updatedItem, allocations } = await allocateAndDecrement({
      itemId: item._id,
      quantity,
      session,
    });

    const transactions = allocations.map((allocation) => ({
      item: item._id,
      batch: allocation.batch,
      batchNumber: allocation.batchNumber,
      type: payload.type || "STOCK_OUT",
      quantity: allocation.quantity,
      previousStock: allocation.previousStock,
      newStock: allocation.newStock,
      reason: String(payload.reason).slice(0, 300),
      recipient: String(payload.recipient || "").slice(0, 200),
      notes: String(payload.remarks || "").slice(0, 1000),
      performedBy: actor.userId,
      performedByRole: actor.role,
      relatedPatient: payload.relatedPatient || null,
      relatedAppointment: payload.relatedAppointment || null,
    }));

    const created = await InventoryTransaction.create(
      transactions,
      session ? { session, ordered: true } : {}
    );

    return { item: updatedItem, transactions: created, batchesUsed: allocations.length };
  });
};

module.exports = { stockOut };
