"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryTransaction = require("../../models/InventoryTransaction");
const Supplier = require("../../models/Supplier");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { notFound } = require("../../utils/AppError");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { serializeTransaction } = require("./inventory.serializers");
const { assertCan, resolvePaging, pagingMeta } = require("./inventory.access");

const getItemHistory = asyncHandler(async (req, res) => {
  assertCan(req, "history");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await InventoryItem.findById(itemId).select("_id name unit").lean();
  if (!item) throw notFound("Inventory item not found.");

  const { pageNumber, pageLimit, skip } = resolvePaging(req.query, 20);

  const [entries, total] = await Promise.all([
    InventoryTransaction.find({ item: itemId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit)
      .populate("performedBy", "fullname role")
      .lean(),
    InventoryTransaction.countDocuments({ item: itemId }),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory history loaded successfully.",
    ...pagingMeta(total, pageNumber, pageLimit),
    history: entries.map(serializeTransaction),
  });
});

const getSuppliers = asyncHandler(async (req, res) => {
  assertCan(req, "view");

  const suppliers = await Supplier.find({ isActive: true }).sort({ name: 1 }).lean();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Suppliers loaded successfully.",
    suppliers: suppliers.map((supplier) => ({
      _id: String(supplier._id),
      name: supplier.name,
      type: supplier.type,
      contactPerson: supplier.contactPerson || "",
      phone: supplier.phone || "",
    })),
  });
});

module.exports = { getItemHistory, getSuppliers };
