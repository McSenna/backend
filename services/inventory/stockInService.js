"use strict";

const InventoryBatch = require("../../models/InventoryBatch");
const InventoryItem = require("../../models/InventoryItem");
const { FACILITY_NAME } = require("../../config/inventoryMovements");
const { cleanText, readQuantity, readReceipt } = require("./stockValidation");
const { runInTransaction, STOCK_TRANSACTION } = require("./transactionRunner");
const { expireLapsedBatches, recalculateItemStock } = require("./stockLedger");
const { findReplay, lockItem, readOperationId, recordMovements } = require("./movementRecorder");

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
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true, session }
  );

const replayResult = async (rows, session) => ({
  batch: await InventoryBatch.findById(rows[0].batch).session(session),
  item: await InventoryItem.findById(rows[0].item).session(session),
  transaction: rows[0],
  replayed: true,
});

const stockIn = async ({ item, payload, actor, supplierName = "" }) => {
  const quantity = readQuantity(payload.quantity);
  const { batchNumber, expiryDate, receivedDate } = readReceipt(payload);
  const operationId = readOperationId(payload);

  return runInTransaction(async (session) => {
    await lockItem(item._id, session);

    const replay = await findReplay({ itemId: item._id, operationId, session });
    if (replay) return replayResult(replay, session);

    // A lot that lapsed today gets its own record first, so this receipt's counts stay exact.
    await expireLapsedBatches(item._id, session);
    const before = await InventoryItem.findById(item._id).session(session);

    const batch = await upsertBatch({
      item, payload, actor, batchNumber, expiryDate, receivedDate, quantity, session,
    });

    const updatedItem = await recalculateItemStock(item._id, session);

    await InventoryItem.findByIdAndUpdate(
      item._id,
      { lastRestockedAt: receivedDate, updatedBy: actor.userId },
      { session }
    );

    const [transaction] = await recordMovements({
      item: before,
      actor,
      operationId,
      session,
      lines: [
        {
          batch: batch._id,
          batchNumber,
          type: "STOCK_IN",
          quantity,
          previousStock: before.currentStock,
          newStock: updatedItem.currentStock,
          reason: cleanText(payload.reason || "Stock received", 300),
          source: cleanText(payload.source || supplierName, 200),
          destinationName: FACILITY_NAME,
          referenceNumber: cleanText(payload.referenceNumber, 80),
          notes: cleanText(payload.remarks, 1000),
        },
      ],
    });

    return { batch, item: updatedItem, transaction };
  }, STOCK_TRANSACTION);
};

module.exports = { stockIn };
