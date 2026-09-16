"use strict";

const InventoryItem = require("../../models/InventoryItem");
const Supplier = require("../../models/Supplier");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { badRequest, conflict } = require("../../utils/AppError");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { evaluateStockAlerts, getItemOrThrow } = require("../../services/inventoryService");
const { serializeItem } = require("./inventory.serializers");
const { assertCan } = require("./inventory.access");
const { readItemPayload } = require("./itemPayload");

const assertSupplierExists = async (supplierId) => {
  if (!supplierId) return;
  const supplier = await Supplier.findById(supplierId).lean();
  if (!supplier) throw badRequest("The selected supplier no longer exists.");
};

const auditFields = (item) => ({
  reorderLevel: item.reorderLevel,
  category: item.category,
  unit: item.unit,
});

const createInventoryItem = asyncHandler(async (req, res) => {
  assertCan(req, "create");

  const { payload, errors } = readItemPayload(req.body);
  if (errors.length) throw badRequest(errors.join(". "));

  await assertSupplierExists(payload.supplier);

  const duplicate = await InventoryItem.findOne({
    name: payload.name,
    specification: payload.specification || "",
    isActive: true,
  }).lean();
  if (duplicate) {
    throw conflict("An active inventory item with this name and specification already exists.");
  }

  const item = await InventoryItem.create({
    ...payload,
    currentStock: 0,
    createdBy: req.user.userId,
    updatedBy: req.user.userId,
  });

  await createSystemLog({
    req,
    action: "INVENTORY_ITEM_CREATED",
    resource: "InventoryItem",
    resourceId: String(item._id),
    description: `Created inventory item "${item.name}"`,
    metadata: { category: item.category, unit: item.unit, reorderLevel: item.reorderLevel },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Inventory item created successfully.",
    item: serializeItem(item.toObject()),
  });
});

const updateInventoryItem = asyncHandler(async (req, res) => {
  assertCan(req, "edit");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await getItemOrThrow(itemId);

  if (req.body.currentStock !== undefined || req.body.stock !== undefined) {
    throw badRequest(
      "Stock quantity cannot be edited directly. Use Add Stock or Release Stock so the change is recorded."
    );
  }

  const { payload, errors } = readItemPayload(req.body, { partial: true });
  if (errors.length) throw badRequest(errors.join(". "));

  await assertSupplierExists(payload.supplier);

  const before = auditFields(item);

  Object.assign(item, payload, { updatedBy: req.user.userId });
  await item.save();

  await createSystemLog({
    req,
    action: "INVENTORY_ITEM_UPDATED",
    resource: "InventoryItem",
    resourceId: String(item._id),
    description: `Updated inventory item "${item.name}"`,
    metadata: { before, after: auditFields(item) },
  });

  await evaluateStockAlerts(item);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Item updated successfully.",
    item: serializeItem(item.toObject()),
  });
});

const deactivateInventoryItem = asyncHandler(async (req, res) => {
  assertCan(req, "deactivate");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await getItemOrThrow(itemId);

  item.isActive = false;
  item.updatedBy = req.user.userId;
  await item.save();

  await createSystemLog({
    req,
    action: "INVENTORY_ITEM_DEACTIVATED",
    resource: "InventoryItem",
    resourceId: String(item._id),
    description: `Deactivated inventory item "${item.name}"`,
    metadata: { remainingStock: item.currentStock },
  });

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Item deactivated successfully.",
    item: serializeItem(item.toObject()),
  });
});

module.exports = { createInventoryItem, updateInventoryItem, deactivateInventoryItem };
