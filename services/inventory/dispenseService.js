"use strict";

const InventoryItem = require("../../models/InventoryItem");
const { FACILITY_NAME } = require("../../config/inventoryMovements");
const { notFound } = require("../../utils/AppError");
const { allocateAndDecrement } = require("./fefoAllocator");
const { lockItem, recordMovements } = require("./movementRecorder");

const itemLabel = (item) =>
  `${item.name}${item.specification ? ` (${item.specification})` : ""}`;

const loadDispensableItem = async (itemId, session) => {
  const itemQuery = InventoryItem.findOne({ _id: itemId, isActive: true });
  if (session) itemQuery.session(session);
  const item = await itemQuery;

  if (!item) {
    throw notFound(
      "One of the selected items is no longer available in the inventory. Remove it and try again."
    );
  }
  return item;
};

const buildDispenseLines = ({ allocations, context }) =>
  allocations.map((allocation) => ({
    batch: allocation.batch,
    batchNumber: allocation.batchNumber,
    type: "STOCK_OUT",
    status: "issued",
    quantity: allocation.quantity,
    previousStock: allocation.previousStock,
    newStock: allocation.newStock,
    reason: "Dispensed to patient",
    source: FACILITY_NAME,
    destinationName: context.serviceLabel ? String(context.serviceLabel).slice(0, 200) : "Patient care",
    recipient: context.patientName ? String(context.patientName).slice(0, 200) : "",
    recipientDesignation: "Patient",
    notes: context.serviceLabel ? `${context.serviceLabel}`.slice(0, 1000) : "",
    relatedPatient: context.patientId || null,
    relatedAppointment: context.appointmentId || null,
    relatedMedicalRecord: context.medicalRecordId || null,
  }));

const buildRecordEntry = ({ item, allocations, created }) => {
  const expiries = allocations.map((allocation) => allocation.expiryDate).filter(Boolean);

  return {
    item: item._id,
    itemName: item.name,
    specification: item.specification || "",
    category: item.category,
    unit: item.unit,
    quantity: allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
    batchNumbers: allocations.map((allocation) => allocation.batchNumber).filter(Boolean),
    expiryDate: expiries.length
      ? new Date(Math.min(...expiries.map((date) => new Date(date))))
      : null,
    transactions: created.map((transaction) => transaction._id),
  };
};

const dispenseItems = async ({ requests, actor, context, session = null }) => {
  if (!Array.isArray(requests) || requests.length === 0) return [];

  const results = [];

  for (const request of requests) {
    const item = await loadDispensableItem(request.itemId, session);
    await lockItem(item._id, session);

    const { allocations, item: updatedItem } = await allocateAndDecrement({
      itemId: item._id,
      quantity: request.quantity,
      session,
    });

    const created = await recordMovements({
      item,
      actor,
      session,
      lines: buildDispenseLines({ allocations, context }),
    });

    results.push({
      item: updatedItem,
      label: itemLabel(item),
      recordEntry: buildRecordEntry({ item, allocations, created }),
      transactions: created,
    });
  }

  return results;
};

module.exports = { dispenseItems };
