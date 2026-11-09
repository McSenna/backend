"use strict";

const InventoryBatch = require("../../models/InventoryBatch");
const { FACILITY_NAME } = require("../../config/inventoryMovements");
const { conflict } = require("../../utils/AppError");
const { applyLotDelta } = require("./lotDelta");
const { findReplay, lockItem, readOperationId, recordMovements } = require("./movementRecorder");
const { assertActiveItem, assertNotReversed, loadOriginal, replayedItem, returnedSoFar } = require("./stockCorrectionShared");
const { recalculateItemStock } = require("./stockLedger");
const { cleanText, readRequiredReason } = require("./stockValidation");
const { runInTransaction, STOCK_TRANSACTION } = require("./transactionRunner");

const assertReversible = async (original, session) => {
  if (original.relation === "reversal" || original.relation === "opening") {
    throw conflict("This record is itself a correction and cannot be reversed.");
  }
  if (original.recordedBySystem) throw conflict("Lot expiries are recorded by the system and cannot be reversed.");
  if (original.relatedAppointment) {
    throw conflict("Stock dispensed at an appointment is part of a medical record. Record a return instead.");
  }
  // A return recorded as unusable changes no stock, but a wrong one must still be undoable.
  if (original.newStock === original.previousStock && original.relation !== "return") {
    throw conflict("This record did not change the stock, so there is nothing to reverse.");
  }
  await assertNotReversed(original, session);
  if ((await returnedSoFar(original, session)) > 0) {
    throw conflict("Part of this release has been returned. Reverse those returns first.");
  }
};

// Undoes exactly what the original did to its lot. A receipt also comes off the lot's received total.
const undoLotChange = async (original, session) => {
  const change = original.newStock - original.previousStock;
  if (change === 0) return;
  const delta = change > 0 ? -original.quantity : original.quantity;
  await applyLotDelta({ batchId: original.batch, delta, session });
  if (original.type === "STOCK_IN") {
    await InventoryBatch.updateOne({ _id: original.batch }, { $inc: { quantityReceived: -original.quantity } }, { session });
  }
};

const reverseMovement = async ({ transactionId, payload, actor }) => {
  const reason = readRequiredReason(payload, "Add a reason for the reversal.");
  const operationId = readOperationId(payload);

  return runInTransaction(async (session) => {
    const original = await loadOriginal(transactionId, session);
    const item = await lockItem(original.item, session);

    const replay = await findReplay({ itemId: item._id, operationId, session });
    if (replay) return { item: await replayedItem(item._id, session), transaction: replay[0], replayed: true };

    await assertReversible(original, session);
    assertActiveItem(item);
    await undoLotChange(original, session);

    const updatedItem = await recalculateItemStock(item._id, session);

    const [transaction] = await recordMovements({
      item,
      actor,
      operationId,
      session,
      lines: [{
        batch: original.batch,
        batchNumber: original.batchNumber,
        type: "ADJUSTMENT",
        quantity: original.quantity,
        previousStock: item.currentStock,
        newStock: updatedItem.currentStock,
        reason,
        source: FACILITY_NAME,
        notes: cleanText(payload.remarks, 1000),
        relatedTransaction: original._id,
        relation: "reversal",
        relatedPatient: original.relatedPatient || null,
      }],
    });

    return { item: updatedItem, transaction, original };
  }, STOCK_TRANSACTION);
};

module.exports = { reverseMovement };
