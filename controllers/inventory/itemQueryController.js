"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { notFound } = require("../../utils/AppError");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { permissionsFor } = require("../../config/inventoryPermissions");
const { expireLapsedBatches, recalculateItemStock } = require("../../services/inventoryService");
const { serializeItem, serializeBatch } = require("./inventory.serializers");
const { SORT_FIELDS, buildListFilter } = require("./inventory.filters");
const { assertCan, resolvePaging, pagingMeta } = require("./inventory.access");

const loadLeadBatches = async (items) => {
  const batches = await InventoryBatch.find({
    item: { $in: items.map((item) => item._id) },
    status: "active",
    quantityRemaining: { $gt: 0 },
  })
    .sort({ expiryDate: 1, receivedDate: 1 })
    .select("item batchNumber expiryDate quantityRemaining")
    .lean();

  const leadBatch = new Map();
  for (const batch of batches) {
    const key = String(batch.item);
    if (!leadBatch.has(key)) leadBatch.set(key, batch);
  }
  return leadBatch;
};

const getInventoryItems = asyncHandler(async (req, res) => {
  assertCan(req, "view");

  await expireLapsedBatches();

  const { pageNumber, pageLimit, skip } = resolvePaging(req.query);
  const filter = await buildListFilter(req.query);
  const sortSpec = SORT_FIELDS[String(req.query.sort ?? "updated_desc")] || SORT_FIELDS.updated_desc;

  const [items, total] = await Promise.all([
    InventoryItem.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(pageLimit)
      .populate("supplier", "name type")
      .lean(),
    InventoryItem.countDocuments(filter),
  ]);

  const leadBatch = await loadLeadBatches(items);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory loaded successfully.",
    count: items.length,
    ...pagingMeta(total, pageNumber, pageLimit),
    permissions: permissionsFor(req.user.role),
    items: items.map((item) =>
      serializeItem(item, {
        batchNumber: leadBatch.get(String(item._id))?.batchNumber || "",
      })
    ),
  });
});

const getInventoryItem = asyncHandler(async (req, res) => {
  assertCan(req, "view");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  await expireLapsedBatches(itemId);
  await recalculateItemStock(itemId);

  const item = await InventoryItem.findById(itemId).populate("supplier", "name type").lean();
  if (!item) throw notFound("Inventory item not found.");

  const batches = await InventoryBatch.find({ item: itemId, quantityRemaining: { $gt: 0 } })
    .sort({ expiryDate: 1, receivedDate: 1 })
    .populate("supplier", "name")
    .lean();

  const lead = batches.find((batch) => batch.status === "active") || batches[0] || null;

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory item loaded successfully.",
    permissions: permissionsFor(req.user.role),
    item: serializeItem(item, {
      batchNumber: lead?.batchNumber || "",
      batches: batches.map(serializeBatch),
    }),
  });
});

module.exports = { getInventoryItems, getInventoryItem };
