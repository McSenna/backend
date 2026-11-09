"use strict";

const InventoryItem = require("../../models/InventoryItem");
const { FACILITY_NAME, ISSUE_TYPES } = require("../../config/inventoryMovements");
const { runInTransaction, STOCK_TRANSACTION } = require("./transactionRunner");
const { allocateAndDecrement } = require("./fefoAllocator");
const { cleanText, readDestination, readQuantity, readRequiredReason } = require("./stockValidation");
const { findReplay, lockItem, readOperationId, recordMovements } = require("./movementRecorder");

const stockOut = async ({ item, payload, actor }) => {
  const quantity = readQuantity(payload.quantity);
  const type = payload.type || "STOCK_OUT";
  const reason = readRequiredReason(payload, "A reason for the release is required.");
  const destination = readDestination(payload, type);
  const operationId = readOperationId(payload);

  return runInTransaction(async (session) => {
    await lockItem(item._id, session);

    const replay = await findReplay({ itemId: item._id, operationId, session });
    if (replay) {
      return {
        item: await InventoryItem.findById(item._id).session(session),
        transactions: replay,
        batchesUsed: replay.length,
        replayed: true,
      };
    }

    const { item: updatedItem, allocations } = await allocateAndDecrement({ itemId: item._id, quantity, session });

    const created = await recordMovements({
      item: updatedItem,
      actor,
      operationId,
      session,
      lines: allocations.map((allocation) => ({
        ...destination,
        batch: allocation.batch,
        batchNumber: allocation.batchNumber,
        type,
        status: ISSUE_TYPES.includes(type) ? "issued" : "completed",
        quantity: allocation.quantity,
        previousStock: allocation.previousStock,
        newStock: allocation.newStock,
        reason,
        source: FACILITY_NAME,
        referenceNumber: cleanText(payload.referenceNumber, 80),
        notes: cleanText(payload.remarks, 1000),
        relatedPatient: payload.relatedPatient || null,
        relatedAppointment: payload.relatedAppointment || null,
      })),
    });

    return { item: updatedItem, transactions: created, batchesUsed: allocations.length };
  }, STOCK_TRANSACTION);
};

module.exports = { stockOut };
