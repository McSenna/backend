"use strict";

const { FACILITY_NAME, ISSUE_TYPES, RETURN_CONDITIONS } = require("../../config/inventoryMovements");
const { badRequest, conflict } = require("../../utils/AppError");
const { applyLotDelta } = require("./lotDelta");
const { findReplay, lockItem, readOperationId, recordMovements } = require("./movementRecorder");
const { assertActiveItem, assertNotReversed, loadOriginal, replayedItem, returnedSoFar } = require("./stockCorrectionShared");
const { recalculateItemStock } = require("./stockLedger");
const { cleanText, readQuantity, readRequiredReason } = require("./stockValidation");
const { runInTransaction, STOCK_TRANSACTION } = require("./transactionRunner");

const readCondition = (payload) => {
  const condition = String(payload.condition || "").toLowerCase();
  if (!RETURN_CONDITIONS.includes(condition)) throw badRequest("Choose the condition of the returned stock.");
  if (condition === "usable" && payload.verified !== true) {
    throw badRequest("Confirm the returned stock was inspected and is fit for use before it goes back into stock.");
  }
  return condition;
};

const returnSource = (original) =>
  original.destinationName || (original.relatedPatient ? "" : original.recipient);

const assertReturnable = async (original, quantity, session) => {
  if (!ISSUE_TYPES.includes(original.type)) throw conflict("Only released or transferred stock can be returned.");
  await assertNotReversed(original, session);
  const left = original.quantity - (await returnedSoFar(original, session));
  if (quantity > left) {
    throw conflict(left === 0 ? "All of this release has already been returned." : `Only ${left} of this release can still be returned.`);
  }
};

const returnStock = async ({ transactionId, payload, actor }) => {
  const quantity = readQuantity(payload.quantity);
  const reason = readRequiredReason(payload, "Add a reason for the return.");
  const condition = readCondition(payload);
  const operationId = readOperationId(payload);

  return runInTransaction(async (session) => {
    const original = await loadOriginal(transactionId, session);
    const item = await lockItem(original.item, session);

    const replay = await findReplay({ itemId: item._id, operationId, session });
    if (replay) return { item: await replayedItem(item._id, session), transaction: replay[0], replayed: true };

    await assertReturnable(original, quantity, session);

    // Stock that cannot be used again is on record as returned but never counted as available.
    const restock = condition === "usable";
    if (restock) {
      assertActiveItem(item);
      await applyLotDelta({ batchId: original.batch, delta: quantity, session });
    }
    const updatedItem = restock ? await recalculateItemStock(item._id, session) : item;

    const [transaction] = await recordMovements({
      item,
      actor,
      operationId,
      session,
      lines: [{
        batch: original.batch,
        batchNumber: original.batchNumber,
        type: "RETURNED",
        quantity,
        previousStock: item.currentStock,
        newStock: updatedItem.currentStock,
        reason,
        source: returnSource(original),
        destinationName: FACILITY_NAME,
        notes: cleanText(payload.remarks, 1000),
        relatedTransaction: original._id,
        relation: "return",
        returnCondition: condition,
        relatedPatient: original.relatedPatient || null,
      }],
    });

    return { item: updatedItem, transaction };
  }, STOCK_TRANSACTION);
};

module.exports = { returnStock };
