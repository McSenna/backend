"use strict";

const Supplier = require("../../models/Supplier");
const { PERISHABLE_CATEGORIES } = require("../../models/InventoryItem");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId, isValidObjectId } = require("../../utils/objectId");
const { badRequest } = require("../../utils/AppError");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const {
  evaluateStockAlerts,
  getItemOrThrow,
  stockIn,
  stockOut,
} = require("../../services/inventoryService");
const { serializeItem, serializeBatch, serializeTransaction } = require("./inventory.serializers");
const { assertCan } = require("./inventory.access");

const RELEASE_TYPES = ["STOCK_OUT", "EXPIRED", "DAMAGED", "TRANSFER", "ADJUSTMENT"];

const plain = (doc) => (doc.toObject ? doc.toObject() : doc);

const addStock = asyncHandler(async (req, res) => {
  assertCan(req, "stockIn");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await getItemOrThrow(itemId);

  if (!req.body.expiryDate && PERISHABLE_CATEGORIES.includes(item.category)) {
    throw badRequest(`An expiry date is required when receiving ${item.category} stock.`);
  }

  if (req.body.supplier) {
    if (!isValidObjectId(req.body.supplier)) {
      throw badRequest("Supplier is not a valid reference.");
    }
    const supplier = await Supplier.findById(req.body.supplier).lean();
    if (!supplier) throw badRequest("The selected supplier no longer exists.");
  }

  const { batch, item: updated, transaction } = await stockIn({
    item,
    payload: req.body,
    actor: { userId: req.user.userId, role: req.user.role },
  });

  await createSystemLog({
    req,
    action: "INVENTORY_STOCK_IN",
    resource: "InventoryItem",
    resourceId: String(item._id),
    description: `Added ${transaction.quantity} ${item.unit} to "${item.name}" (batch ${batch.batchNumber})`,
    metadata: {
      batchNumber: batch.batchNumber,
      quantity: transaction.quantity,
      previousStock: transaction.previousStock,
      newStock: transaction.newStock,
      source: transaction.source,
    },
  });

  await evaluateStockAlerts(updated);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Stock added successfully.",
    item: serializeItem(updated.toObject()),
    batch: serializeBatch(plain(batch)),
  });
});

const releaseStock = asyncHandler(async (req, res) => {
  assertCan(req, "stockOut");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await getItemOrThrow(itemId);

  if (req.body.relatedPatient && !isValidObjectId(req.body.relatedPatient)) {
    throw badRequest("Related patient is not a valid reference.");
  }
  if (req.body.relatedAppointment && !isValidObjectId(req.body.relatedAppointment)) {
    throw badRequest("Related appointment is not a valid reference.");
  }

  const requestedType = String(req.body.type || "STOCK_OUT").toUpperCase();
  if (!RELEASE_TYPES.includes(requestedType)) {
    throw badRequest("Unsupported release type.");
  }

  const { item: updated, transactions } = await stockOut({
    item,
    payload: { ...req.body, type: requestedType },
    actor: { userId: req.user.userId, role: req.user.role },
  });

  const totalReleased = transactions.reduce((sum, entry) => sum + entry.quantity, 0);
  const batchesUsed = transactions.map((entry) => entry.batchNumber).filter(Boolean);

  await createSystemLog({
    req,
    action: requestedType === "STOCK_OUT" ? "INVENTORY_STOCK_OUT" : "INVENTORY_ADJUSTED",
    resource: "InventoryItem",
    resourceId: String(item._id),
    description: `Released ${totalReleased} ${item.unit} of "${item.name}"`,
    metadata: {
      quantity: totalReleased,
      type: requestedType,
      batches: batchesUsed,
      recipient: String(req.body.recipient || ""),
      newStock: updated.currentStock,
    },
  });

  await evaluateStockAlerts(updated);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Stock released successfully.",
    item: serializeItem(updated.toObject()),
    transactions: transactions.map((entry) => serializeTransaction(plain(entry))),
  });
});

module.exports = { addStock, releaseStock };
