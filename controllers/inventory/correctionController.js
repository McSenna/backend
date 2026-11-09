"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { adjustLot, evaluateStockAlerts, returnStock, reverseMovement } = require("../../services/inventoryService");
const { serializeItem, serializeTransaction } = require("./inventory.serializers");

const actorOf = (req) => ({ userId: req.user.userId, role: req.user.role });

const finish = async ({ req, res, result, action, description, message }) => {
  if (!result.replayed) {
    await createSystemLog({
      req,
      action,
      resource: "InventoryItem",
      resourceId: String(result.item._id),
      description: description(result),
      metadata: {
        reference: result.transaction.reference,
        quantity: result.transaction.quantity,
        previousStock: result.transaction.previousStock,
        newStock: result.transaction.newStock,
      },
    });
    await evaluateStockAlerts(result.item);
  }

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message,
    item: serializeItem(result.item.toObject()),
    transaction: serializeTransaction(result.transaction.toObject()),
  });
};

const recordReturn = asyncHandler(async (req, res) => {
  const transactionId = assertValidObjectId(req.params.id, "inventory movement");
  const result = await returnStock({ transactionId, payload: req.body, actor: actorOf(req) });

  return finish({
    req,
    res,
    result,
    action: "INVENTORY_RETURN_RECORDED",
    description: ({ item, transaction }) => `Recorded a return of ${transaction.quantity} ${item.unit} of "${item.name}"`,
    message: result.transaction.newStock > result.transaction.previousStock
      ? "Return recorded and added back to stock."
      : "Return recorded. It was not added to usable stock.",
  });
});

const reverse = asyncHandler(async (req, res) => {
  const transactionId = assertValidObjectId(req.params.id, "inventory movement");
  const result = await reverseMovement({ transactionId, payload: req.body, actor: actorOf(req) });

  return finish({
    req,
    res,
    result,
    action: "INVENTORY_REVERSED",
    description: ({ item, transaction }) => `Reversed a movement of ${transaction.quantity} ${item.unit} of "${item.name}"`,
    message: "Movement reversed. The original record is kept.",
  });
});

const correctCount = asyncHandler(async (req, res) => {
  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const batchId = assertValidObjectId(req.body.batchId, "inventory lot");
  const result = await adjustLot({ itemId, batchId, payload: req.body, actor: actorOf(req) });

  return finish({
    req,
    res,
    result,
    action: "INVENTORY_ADJUSTED",
    description: ({ item, transaction }) => `Corrected the count of "${item.name}" by ${transaction.quantity} ${item.unit}`,
    message: "Count corrected.",
  });
});

module.exports = { recordReturn, reverse, correctCount };
