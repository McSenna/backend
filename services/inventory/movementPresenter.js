"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryTransaction = require("../../models/InventoryTransaction");
const { ISSUE_TYPES, SYSTEM_ACTOR_NAME, groupOfType } = require("../../config/inventoryMovements");

const { itemCodeOf } = InventoryItem;

const emptyLink = Object.freeze({ reversedBy: "", returned: 0, returns: [] });

// Which later records point back at each row. Rows never change, so "reversed" is read from here.
const loadMovementLinks = async (ids) => {
  const links = new Map();
  if (ids.length === 0) return links;

  const rows = await InventoryTransaction.find({ relatedTransaction: { $in: ids }, relation: { $in: ["return", "reversal"] } })
    .select("relatedTransaction relation reference quantity")
    .lean();

  // A return that was itself reversed no longer counts against its release.
  const returnIds = rows.filter((row) => row.relation === "return").map((row) => row._id);
  const undone = new Set(
    (await InventoryTransaction.distinct("relatedTransaction", { relation: "reversal", relatedTransaction: { $in: returnIds } })).map(String)
  );

  for (const row of rows) {
    if (undone.has(String(row._id))) continue;
    const key = String(row.relatedTransaction);
    const link = links.get(key) ?? { reversedBy: "", returned: 0, returns: [] };
    if (row.relation === "reversal") link.reversedBy = row.reference || "";
    if (row.relation === "return") {
      link.returned += row.quantity;
      link.returns.push(row.reference || "");
    }
    links.set(key, link);
  }
  return links;
};

const statusOf = (row, link) => {
  if (link.reversedBy) return "reversed";
  return row.status || (ISSUE_TYPES.includes(row.type) ? "issued" : "completed");
};

const correctionsOf = (row, link) => ({
  returnable: ISSUE_TYPES.includes(row.type) && !link.reversedBy ? Math.max(0, row.quantity - link.returned) : 0,
  reversible:
    !["reversal", "opening"].includes(row.relation) &&
    !row.recordedBySystem &&
    !row.relatedAppointment &&
    (row.newStock !== row.previousStock || row.relation === "return") &&
    !link.reversedBy &&
    link.returned === 0,
});

const itemOf = (row) => {
  const populated = row.item && typeof row.item === "object" && row.item.name ? row.item : null;
  const id = populated?._id ?? row.item;
  return {
    _id: String(id),
    name: row.itemName || populated?.name || "Not recorded",
    specification: row.itemSpecification || populated?.specification || "",
    code: row.itemCode || itemCodeOf(id),
    category: row.itemCategory || populated?.category || "other",
    unit: row.itemUnit || populated?.unit || "",
  };
};

const actorOf = (row) => {
  const populated = row.performedBy && typeof row.performedBy === "object" && row.performedBy.fullname ? row.performedBy : null;
  if (row.recordedBySystem) return { name: SYSTEM_ACTOR_NAME, role: "system" };
  return { name: row.performedByName || populated?.fullname || "Unknown user", role: row.performedByRole || populated?.role || "" };
};

const serializeMovement = (row, link = emptyLink) => ({
  _id: String(row._id),
  reference: row.reference || "",
  createdAt: row.createdAt,
  type: row.type,
  group: groupOfType(row.type),
  status: statusOf(row, link),
  relation: row.relation || null,
  item: itemOf(row),
  batchNumber: row.batchNumber || "",
  quantity: row.quantity,
  previousStock: row.previousStock,
  newStock: row.newStock,
  stockChange: row.newStock - row.previousStock,
  source: row.source || "",
  destination: {
    name: row.destinationName || "",
    department: row.destinationDepartment || "",
    location: row.destinationLocation || "",
  },
  recipient: {
    name: row.recipient || "",
    designation: row.recipientDesignation || "",
    department: row.recipientDepartment || "",
  },
  performedBy: actorOf(row),
  // Nothing in the app confirms a handover yet, so a release is never shown as received.
  receivedBy: "",
  reason: row.reason || "",
  notes: row.notes || "",
  referenceNumber: row.referenceNumber || "",
  returnCondition: row.returnCondition || null,
  isPatientDispensing: Boolean(row.relatedPatient),
  links: { reversedBy: link.reversedBy, returned: link.returned, returns: link.returns },
});

module.exports = { emptyLink, loadMovementLinks, correctionsOf, serializeMovement };
