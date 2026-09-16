"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const InventoryTransaction = require("../../models/InventoryTransaction");
const { readQuantity, readReceipt } = require("./stockValidation");
const { runInTransaction } = require("./transactionRunner");
const { recalculateItemStock } = require("./stockLedger");

const upsertBatch = ({ item, payload, actor, batchNumber, expiryDate, receivedDate, quantity, session }) =>
  InventoryBatch.findOneAndUpdate(
    { item: item._id, batchNumber },
    {
      $inc: { quantityReceived: quantity, quantityRemaining: quantity },
      $setOnInsert: { receivedDate, receivedBy: actor.userId },
      $set: {
        status: "active",
        ...(expiryDate ? { expiryDate } : {}),
        ...(payload.supplier ? { supplier: payload.supplier } : {}),
        ...(payload.storageCondition ? { storageCondition: payload.storageCondition } : {}),
        ...(payload.remarks ? { remarks: String(payload.remarks).slice(0, 500) } : {}),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );

const stockIn = async ({ item, payload, actor }) => {
  const quantity = readQuantity(payload.quantity);
  const { batchNumber, expiryDate, receivedDate } = readReceipt(payload);

  return runInTransaction(async (session) => {
    const previousStock = item.currentStock;

    const batch = await upsertBatch({
      item, payload, actor, batchNumber, expiryDate, receivedDate, quantity, session,
    });

    const updatedItem = await recalculateItemStock(item._id, session);

    await InventoryItem.findByIdAndUpdate(
      item._id,
      { lastRestockedAt: receivedDate, updatedBy: actor.userId },
      { session }
    );

    const [transaction] = await InventoryTransaction.create(
      [
        {
          item: item._id,
          batch: batch._id,
          batchNumber,
          type: "STOCK_IN",
          quantity,
          previousStock,
          newStock: updatedItem.currentStock,
          reason: String(payload.reason || "Stock received").slice(0, 300),
          source: String(payload.source || "").slice(0, 200),
          notes: String(payload.remarks || "").slice(0, 1000),
          performedBy: actor.userId,
          performedByRole: actor.role,
        },
      ],
      session ? { session } : {}
    );

    return { batch, item: updatedItem, transaction };
  });
};

module.exports = { stockIn };
