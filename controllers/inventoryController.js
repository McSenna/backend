"use strict";

const InventoryItem = require("../models/InventoryItem");
const {
  INVENTORY_CATEGORIES,
  PERISHABLE_CATEGORIES,
  STORAGE_CONDITIONS,
} = require("../models/InventoryItem");
const InventoryBatch = require("../models/InventoryBatch");
const InventoryTransaction = require("../models/InventoryTransaction");
const Supplier = require("../models/Supplier");
const asyncHandler = require("../utils/asyncHandler");
const { assertValidObjectId, isValidObjectId } = require("../utils/objectId");
const { badRequest, conflict, forbidden, notFound } = require("../utils/AppError");
const { HTTP_STATUS } = require("../utils/errorCodes");
const { createSystemLog } = require("../services/systemLogService");
const {
  EXPIRY_THRESHOLDS,
  computeExpiryStatus,
  computeStockStatus,
  daysUntil,
  evaluateStockAlerts,
  expireLapsedBatches,
  getItemOrThrow,
  recalculateItemStock,
  startOfDay,
  stockIn,
  stockOut,
} = require("../services/inventoryService");

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 8;

/**
 * Who may do what.
 *
 * Mirrored in the client so buttons a role cannot use are not drawn, but this
 * copy is the one that decides: the client's is a courtesy, and a request that
 * skips the UI is still refused here.
 */
const INVENTORY_PERMISSIONS = {
  admin: { view: true, create: true, edit: true, stockIn: true, stockOut: true, history: true, deactivate: true },
  doctor: { view: true, create: false, edit: false, stockIn: false, stockOut: true, history: true, deactivate: false },
  midwife: { view: true, create: false, edit: false, stockIn: false, stockOut: true, history: true, deactivate: false },
  bhw: { view: true, create: false, edit: false, stockIn: true, stockOut: true, history: true, deactivate: false },
  resident: { view: false, create: false, edit: false, stockIn: false, stockOut: false, history: false, deactivate: false },
};

function permissionsFor(role) {
  return INVENTORY_PERMISSIONS[role] || INVENTORY_PERMISSIONS.resident;
}

function assertCan(req, capability) {
  const allowed = permissionsFor(req.user?.role)[capability];
  if (!allowed) {
    throw forbidden("You do not have permission to perform this action.");
  }
}

const SORT_FIELDS = {
  updated_desc: { updatedAt: -1 },
  updated_asc: { updatedAt: 1 },
  name_asc: { name: 1 },
  name_desc: { name: -1 },
  stock_asc: { currentStock: 1 },
  stock_desc: { currentStock: -1 },
  // Items with no expiry sort last on "nearest" so perishables lead the list.
  expiry_asc: { nearestExpiry: 1 },
  expiry_desc: { nearestExpiry: -1 },
};

/**
 * Adds the derived fields the UI reads.
 *
 * Status is computed here rather than stored so the label can never disagree
 * with the figure beside it, and so a day passing is enough to move a row from
 * "Expiring Soon" to "Expired" without a write.
 */
function serializeItem(item, extras = {}) {
  const stockStatus = computeStockStatus(item.currentStock, item.reorderLevel);
  const expiryStatus = computeExpiryStatus(item.nearestExpiry);

  return {
    _id: String(item._id),
    name: item.name,
    specification: item.specification || "",
    genericName: item.genericName || "",
    description: item.description || "",
    category: item.category,
    unit: item.unit,
    reorderLevel: item.reorderLevel,
    currentStock: item.currentStock,
    storageCondition: item.storageCondition || "",
    supplier: item.supplier
      ? typeof item.supplier === "object" && item.supplier.name
        ? { _id: String(item.supplier._id), name: item.supplier.name, type: item.supplier.type }
        : { _id: String(item.supplier), name: "", type: "" }
      : null,
    nearestExpiry: item.nearestExpiry || null,
    lastRestockedAt: item.lastRestockedAt || null,
    isActive: item.isActive !== false,
    stockStatus,
    expiryStatus,
    daysUntilExpiry: daysUntil(item.nearestExpiry),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...extras,
  };
}

function serializeBatch(batch) {
  return {
    _id: String(batch._id),
    batchNumber: batch.batchNumber,
    quantityReceived: batch.quantityReceived,
    quantityRemaining: batch.quantityRemaining,
    expiryDate: batch.expiryDate || null,
    receivedDate: batch.receivedDate || null,
    storageCondition: batch.storageCondition || "",
    status: batch.status,
    expiryStatus: computeExpiryStatus(batch.expiryDate),
    daysUntilExpiry: daysUntil(batch.expiryDate),
    supplier: batch.supplier?.name ? { _id: String(batch.supplier._id), name: batch.supplier.name } : null,
  };
}

function serializeTransaction(entry) {
  const performer = entry.performedBy && typeof entry.performedBy === "object" ? entry.performedBy : null;

  return {
    _id: String(entry._id),
    type: entry.type,
    quantity: entry.quantity,
    previousStock: entry.previousStock,
    newStock: entry.newStock,
    batchNumber: entry.batchNumber || "",
    reason: entry.reason || "",
    source: entry.source || "",
    recipient: entry.recipient || "",
    notes: entry.notes || "",
    performedByName: performer?.fullname || "Unknown user",
    performedByRole: entry.performedByRole || performer?.role || "",
    createdAt: entry.createdAt,
  };
}

/**
 * Stock and expiry are derived, so they cannot be Mongo query conditions the
 * way a stored field can. They are expressed as equivalent conditions on the
 * fields that do exist, keeping the filter server-side and the pagination
 * honest — filtering a page after it was fetched would report wrong totals.
 */
function buildStockStatusFilter(stockStatus) {
  switch (stockStatus) {
    case "out-of-stock":
      return { currentStock: { $lte: 0 } };
    case "low-stock":
      return {
        $expr: {
          $and: [{ $gt: ["$currentStock", 0] }, { $lte: ["$currentStock", "$reorderLevel"] }],
        },
      };
    case "in-stock":
      return { $expr: { $gt: ["$currentStock", "$reorderLevel"] } };
    default:
      return null;
  }
}

function buildExpiryStatusFilter(expiryStatus, now = new Date()) {
  const today = startOfDay(now);
  const addDays = (days) => new Date(today.getTime() + days * 24 * 60 * 60 * 1000);

  switch (expiryStatus) {
    case "none":
      return { nearestExpiry: null };
    case "expired":
      return { nearestExpiry: { $ne: null, $lt: today } };
    case "urgent":
      return { nearestExpiry: { $gte: today, $lte: addDays(EXPIRY_THRESHOLDS.urgent) } };
    case "expiring-soon":
      // The card and the filter agree: everything due inside the 90-day window,
      // including the urgent band, so the count and the filtered list match.
      return { nearestExpiry: { $gte: today, $lte: addDays(EXPIRY_THRESHOLDS.soon) } };
    case "normal":
      return { nearestExpiry: { $gt: addDays(EXPIRY_THRESHOLDS.soon) } };
    default:
      return null;
  }
}

async function buildListFilter(query) {
  const { search = "", category = "all", stockStatus = "all", expiryStatus = "all" } = query;

  const conditions = [{ isActive: true }];

  const term = String(search || "").trim();
  if (term) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(safe, "i");

    // Batch and supplier live in other collections, so the search resolves them
    // to ids first — the toolbar promises a lot-number search and a row whose
    // lot matches has to come back even though the item document has no lot.
    const [batches, suppliers] = await Promise.all([
      InventoryBatch.find({ batchNumber: pattern }).select("item").lean(),
      Supplier.find({ name: pattern }).select("_id").lean(),
    ]);

    conditions.push({
      $or: [
        { name: pattern },
        { genericName: pattern },
        { specification: pattern },
        { description: pattern },
        { category: pattern },
        { unit: pattern },
        ...(batches.length ? [{ _id: { $in: batches.map((b) => b.item) } }] : []),
        ...(suppliers.length ? [{ supplier: { $in: suppliers.map((s) => s._id) } }] : []),
      ],
    });
  }

  if (category !== "all" && INVENTORY_CATEGORIES.includes(String(category))) {
    conditions.push({ category: String(category) });
  }

  const stockFilter = buildStockStatusFilter(String(stockStatus));
  if (stockFilter) conditions.push(stockFilter);

  const expiryFilter = buildExpiryStatusFilter(String(expiryStatus));
  if (expiryFilter) conditions.push(expiryFilter);

  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

const getInventoryItems = asyncHandler(async (req, res) => {
  assertCan(req, "view");

  // Lapsed lots leave the available pool before anything is counted, so a page
  // loaded the morning after an expiry shows the item as expired immediately.
  await expireLapsedBatches();

  const { page = 1, limit = DEFAULT_PAGE_SIZE, sort = "updated_desc" } = req.query;

  const pageNumber = Math.max(1, Number(page) || 1);
  const pageLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
  const skip = (pageNumber - 1) * pageLimit;

  const filter = await buildListFilter(req.query);
  const sortSpec = SORT_FIELDS[String(sort)] || SORT_FIELDS.updated_desc;

  const [items, total] = await Promise.all([
    InventoryItem.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(pageLimit)
      .populate("supplier", "name type")
      .lean(),
    InventoryItem.countDocuments(filter),
  ]);

  // The list column shows the lot the next release would draw from, which FEFO
  // makes the nearest-expiry active batch rather than the newest receipt.
  const batches = await InventoryBatch.find({
    item: { $in: items.map((i) => i._id) },
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

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory loaded successfully.",
    count: items.length,
    total,
    page: pageNumber,
    limit: pageLimit,
    totalPages: Math.max(1, Math.ceil(total / pageLimit)),
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

  const lead = batches.find((b) => b.status === "active") || batches[0] || null;

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

/** Powers the four metric cards. Counts, not a page of rows. */
const getInventorySummary = asyncHandler(async (req, res) => {
  assertCan(req, "view");
  await expireLapsedBatches();

  const today = startOfDay(new Date());
  const soonCutoff = new Date(today.getTime() + EXPIRY_THRESHOLDS.soon * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const active = { isActive: true };

  const [total, inStock, lowStock, outOfStock, expiringSoon, expired, totalLastMonth] =
    await Promise.all([
      InventoryItem.countDocuments(active),
      InventoryItem.countDocuments({ ...active, $expr: { $gt: ["$currentStock", "$reorderLevel"] } }),
      InventoryItem.countDocuments({
        ...active,
        $expr: { $and: [{ $gt: ["$currentStock", 0] }, { $lte: ["$currentStock", "$reorderLevel"] }] },
      }),
      InventoryItem.countDocuments({ ...active, currentStock: { $lte: 0 } }),
      InventoryItem.countDocuments({ ...active, nearestExpiry: { $gte: today, $lte: soonCutoff } }),
      InventoryItem.countDocuments({ ...active, nearestExpiry: { $ne: null, $lt: today } }),
      InventoryItem.countDocuments({ ...active, createdAt: { $lt: monthAgo } }),
    ]);

  // The only honest trend the data supports: how the catalogue has grown. A
  // per-bucket trend would need historical snapshots that are not recorded, and
  // is omitted rather than invented.
  const growth = totalLastMonth > 0 ? Math.round(((total - totalLastMonth) / totalLastMonth) * 100) : null;

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory summary loaded successfully.",
    summary: {
      total: { value: total, growth },
      inStock: { value: inStock, growth: null },
      lowStock: { value: lowStock, growth: null },
      expiringSoon: { value: expiringSoon, growth: null },
      outOfStock: { value: outOfStock, growth: null },
      expired: { value: expired, growth: null },
    },
  });
});

/** Low stock, out of stock and near-expiry rows, for the alerts feed. */
const getInventoryAlerts = asyncHandler(async (req, res) => {
  assertCan(req, "view");
  await expireLapsedBatches();

  const today = startOfDay(new Date());
  const soonCutoff = new Date(today.getTime() + EXPIRY_THRESHOLDS.soon * 24 * 60 * 60 * 1000);

  const [lowOrOut, expiring] = await Promise.all([
    InventoryItem.find({
      isActive: true,
      $expr: { $lte: ["$currentStock", "$reorderLevel"] },
    })
      .sort({ currentStock: 1 })
      .limit(50)
      .lean(),
    InventoryBatch.find({
      status: "active",
      quantityRemaining: { $gt: 0 },
      expiryDate: { $ne: null, $lte: soonCutoff },
    })
      .sort({ expiryDate: 1 })
      .limit(50)
      .populate("item", "name specification unit isActive")
      .lean(),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory alerts loaded successfully.",
    alerts: {
      stock: lowOrOut.map((item) => ({
        itemId: String(item._id),
        name: item.name,
        specification: item.specification || "",
        currentStock: item.currentStock,
        reorderLevel: item.reorderLevel,
        unit: item.unit,
        status: computeStockStatus(item.currentStock, item.reorderLevel),
      })),
      expiry: expiring
        .filter((batch) => batch.item && batch.item.isActive !== false)
        .map((batch) => ({
          itemId: String(batch.item._id),
          name: batch.item.name,
          specification: batch.item.specification || "",
          unit: batch.item.unit,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantityRemaining: batch.quantityRemaining,
          daysUntilExpiry: daysUntil(batch.expiryDate),
          status: computeExpiryStatus(batch.expiryDate),
        })),
    },
  });
});

function readItemPayload(body, { partial = false } = {}) {
  const payload = {};
  const errors = [];

  const setString = (key, value, { max, required = false, label }) => {
    if (value === undefined) {
      if (required && !partial) errors.push(`${label} is required`);
      return;
    }
    const text = String(value).trim();
    if (required && !text) {
      errors.push(`${label} is required`);
      return;
    }
    if (text.length > max) {
      errors.push(`${label} must be ${max} characters or fewer`);
      return;
    }
    payload[key] = text;
  };

  setString("name", body.name, { max: 160, required: true, label: "Item name" });
  setString("specification", body.specification, { max: 120, label: "Specification" });
  setString("genericName", body.genericName, { max: 160, label: "Generic name" });
  setString("description", body.description, { max: 1000, label: "Description" });
  setString("unit", body.unit, { max: 24, required: true, label: "Unit" });

  if (body.category !== undefined) {
    const category = String(body.category).trim().toLowerCase();
    if (!INVENTORY_CATEGORIES.includes(category)) errors.push("Category is not supported");
    else payload.category = category;
  } else if (!partial) {
    errors.push("Category is required");
  }

  if (body.reorderLevel !== undefined) {
    const reorderLevel = Number(body.reorderLevel);
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isInteger(reorderLevel)) {
      errors.push("Reorder level must be a whole number of zero or more");
    } else {
      payload.reorderLevel = reorderLevel;
    }
  } else if (!partial) {
    errors.push("Reorder level is required");
  }

  if (body.storageCondition !== undefined && String(body.storageCondition).trim()) {
    const storage = String(body.storageCondition).trim();
    if (!STORAGE_CONDITIONS.includes(storage)) errors.push("Storage condition is not supported");
    else payload.storageCondition = storage;
  }

  if (body.supplier !== undefined) {
    if (!body.supplier) payload.supplier = null;
    else if (!isValidObjectId(body.supplier)) errors.push("Supplier is not a valid reference");
    else payload.supplier = String(body.supplier);
  }

  return { payload, errors };
}

const createInventoryItem = asyncHandler(async (req, res) => {
  assertCan(req, "create");

  const { payload, errors } = readItemPayload(req.body);
  if (errors.length) throw badRequest(errors.join(". "));

  if (payload.supplier) {
    const supplier = await Supplier.findById(payload.supplier).lean();
    if (!supplier) throw badRequest("The selected supplier no longer exists.");
  }

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

  // Stock is ledger-owned. Accepting it here would be a silent adjustment with
  // no transaction behind it, which is the one thing this module must not do.
  if (req.body.currentStock !== undefined || req.body.stock !== undefined) {
    throw badRequest(
      "Stock quantity cannot be edited directly. Use Add Stock or Release Stock so the change is recorded."
    );
  }

  const { payload, errors } = readItemPayload(req.body, { partial: true });
  if (errors.length) throw badRequest(errors.join(". "));

  if (payload.supplier) {
    const supplier = await Supplier.findById(payload.supplier).lean();
    if (!supplier) throw badRequest("The selected supplier no longer exists.");
  }

  const before = { reorderLevel: item.reorderLevel, category: item.category, unit: item.unit };

  Object.assign(item, payload, { updatedBy: req.user.userId });
  await item.save();

  await createSystemLog({
    req,
    action: "INVENTORY_ITEM_UPDATED",
    resource: "InventoryItem",
    resourceId: String(item._id),
    description: `Updated inventory item "${item.name}"`,
    metadata: { before, after: { reorderLevel: item.reorderLevel, category: item.category, unit: item.unit } },
  });

  // A raised reorder level can put an item below its threshold without any
  // stock moving, so the alert is re-evaluated on metadata edits too.
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

const addStock = asyncHandler(async (req, res) => {
  assertCan(req, "stockIn");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await getItemOrThrow(itemId);

  // Perishables must carry an expiry date or the expiry rules have nothing to
  // act on; equipment legitimately has none.
  if (!req.body.expiryDate && PERISHABLE_CATEGORIES.includes(item.category)) {
    throw badRequest(`An expiry date is required when receiving ${item.category} stock.`);
  }

  if (req.body.supplier) {
    if (!isValidObjectId(req.body.supplier)) throw badRequest("Supplier is not a valid reference.");
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
    batch: serializeBatch(batch.toObject ? batch.toObject() : batch),
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
  if (!["STOCK_OUT", "EXPIRED", "DAMAGED", "TRANSFER", "ADJUSTMENT"].includes(requestedType)) {
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
    transactions: transactions.map((entry) =>
      serializeTransaction(entry.toObject ? entry.toObject() : entry)
    ),
  });
});

const getItemHistory = asyncHandler(async (req, res) => {
  assertCan(req, "history");

  const itemId = assertValidObjectId(req.params.id, "inventory item");
  const item = await InventoryItem.findById(itemId).select("_id name unit").lean();
  if (!item) throw notFound("Inventory item not found.");

  const pageNumber = Math.max(1, Number(req.query.page) || 1);
  const pageLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || 20));

  const [entries, total] = await Promise.all([
    InventoryTransaction.find({ item: itemId })
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * pageLimit)
      .limit(pageLimit)
      .populate("performedBy", "fullname role")
      .lean(),
    InventoryTransaction.countDocuments({ item: itemId }),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory history loaded successfully.",
    total,
    page: pageNumber,
    limit: pageLimit,
    totalPages: Math.max(1, Math.ceil(total / pageLimit)),
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

module.exports = {
  getInventoryItems,
  getInventoryItem,
  getInventorySummary,
  getInventoryAlerts,
  createInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
  addStock,
  releaseStock,
  getItemHistory,
  getSuppliers,
  INVENTORY_PERMISSIONS,
  permissionsFor,
};
