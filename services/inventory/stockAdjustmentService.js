"use strict";

const InventoryBatch = require("../../models/InventoryBatch");
const { ADJUSTMENT_CATEGORIES, FACILITY_NAME } = require("../../config/inventoryMovements");
const { badRequest, notFound } = require("../../utils/AppError");
const { applyLotDelta } = require("./lotDelta");
const { findReplay, lockItem, readOperationId, recordMovements } = require("./movementRecorder");
const { assertActiveItem, replayedItem } = require("./stockCorrectionShared");
const { expireLapsedBatches, recalculateItemStock } = require("./stockLedger");
const { cleanText, readRequiredReason } = require("./stockValidation");
const { runInTransaction, STOCK_TRANSACTION } = require("./transactionRunner");

const readCount = (raw) => {
  const count = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
  if (raw === "" || !Number.isSafeInteger(count) || count < 0) {
    throw badRequest("The counted quantity must be a whole number of zero or more.");
  }
  return count;
};

const readCategory = (raw) => {
  const label = ADJUSTMENT_CATEGORIES[String(raw || "")];
  if (!label) throw badRequest("Choose why the count is being corrected.");
  return label;
};

const adjustLot = async ({ itemId, batchId, payload, actor }) => {
  const countedQuantity = readCount(payload.countedQuantity);
  const category = readCategory(payload.category);
  const note = readRequiredReason(payload, "Add a reason for the correction.");
  const operationId = readOperationId(payload);

  return runInTransaction(async (session) => {
    const item = await lockItem(itemId, session);

    const replay = await findReplay({ itemId, operationId, session });
    if (replay) return { item: await replayedItem(itemId, session), transaction: replay[0], replayed: true };

    assertActiveItem(item);
    await expireLapsedBatches(itemId, session);
    const before = await replayedItem(itemId, session);

    const lot = await InventoryBatch.findOne({ _id: batchId, item: itemId }).session(session);
    if (!lot) throw notFound("That lot is not part of this item.");

    const delta = countedQuantity - lot.quantityRemaining;
    if (delta === 0) throw badRequest("The count matches the lot, so there is nothing to correct.");

    await applyLotDelta({ batchId: lot._id, delta, session });
    const updatedItem = await recalculateItemStock(itemId, session);

    const [transaction] = await recordMovements({
      item: before,
      actor,
      operationId,
      session,
      lines: [{
        batch: lot._id,
        batchNumber: lot.batchNumber,
        type: "ADJUSTMENT",
        quantity: Math.abs(delta),
        previousStock: before.currentStock,
        newStock: updatedItem.currentStock,
        reason: `${category}: ${note}`.slice(0, 300),
        source: FACILITY_NAME,
        notes: cleanText(payload.remarks, 1000),
      }],
    });

    return { item: updatedItem, transaction, lot };
  }, STOCK_TRANSACTION);
};

module.exports = { adjustLot };
