"use strict";

const { computeExpiryStatus, computeStockStatus, daysUntil } = require("../../services/inventoryService");

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

module.exports = { serializeItem, serializeBatch, serializeTransaction };
