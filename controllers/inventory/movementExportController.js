"use strict";

const InventoryTransaction = require("../../models/InventoryTransaction");
const asyncHandler = require("../../utils/asyncHandler");
const { csvCell } = require("../../utils/csvCell");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { MOVEMENT_SORTS, buildMovementFilter, readMovementQuery } = require("../../services/inventory/movementQuery");
const { emptyLink, loadMovementLinks, serializeMovement } = require("../../services/inventory/movementPresenter");

const EXPORT_ROW_CAP = 10000;
const NOT_RECORDED = "Not recorded";
const MASKED_PATIENT = "Patient (appointment dispensing)";

const HEADER = [
  "Transaction ID", "Date and time", "Product", "Item code", "Lot", "Category", "Movement", "Status",
  "Quantity", "Unit", "Previous stock", "Updated stock", "Source", "Destination", "Department",
  "Location", "Recipient", "Recipient designation", "Released by", "Role", "Reason", "Reference number", "Remarks",
];

const MOVEMENT_LABELS = { stock_in: "Stock In", stock_out: "Stock Out", transfer: "Transfer", return: "Return", adjustment: "Adjustment" };
const STATUS_LABELS = { completed: "Completed", issued: "Issued, receipt not confirmed", reversed: "Reversed" };

const manilaTime = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", dateStyle: "short", timeStyle: "medium" });

const orNotRecorded = (value) => value || NOT_RECORDED;

// A name beside a medicine is health information, so it stays on screen and out of a downloadable file.
const recipientCell = (movement) =>
  movement.isPatientDispensing ? MASKED_PATIENT : orNotRecorded(movement.recipient.name);

const toLine = (m) =>
  [
    m.reference, manilaTime.format(new Date(m.createdAt)), m.item.name, m.item.code, m.batchNumber, m.item.category,
    MOVEMENT_LABELS[m.group], STATUS_LABELS[m.status], m.quantity, m.item.unit, m.previousStock, m.newStock,
    orNotRecorded(m.source), orNotRecorded(m.destination.name), m.destination.department, m.destination.location,
    recipientCell(m), m.recipient.designation, m.performedBy.name, m.performedBy.role, m.reason, m.referenceNumber, m.notes,
  ]
    .map(csvCell)
    .join(",");

const exportMovements = asyncHandler(async (req, res) => {
  const params = readMovementQuery(req.query);
  const rows = await InventoryTransaction.find(buildMovementFilter(params))
    .sort(MOVEMENT_SORTS[params.sort])
    .limit(EXPORT_ROW_CAP + 1)
    .populate("item", "name specification category unit")
    .populate("performedBy", "fullname role")
    .lean();

  const truncated = rows.length > EXPORT_ROW_CAP;
  const page = rows.slice(0, EXPORT_ROW_CAP);
  const links = await loadMovementLinks(page.map((row) => row._id));
  const movements = page.map((row) => serializeMovement(row, links.get(String(row._id)) ?? emptyLink));

  await createSystemLog({
    req,
    action: "INVENTORY_HISTORY_EXPORTED",
    role: req.user.role,
    description: "Admin exported the inventory history",
    resource: "InventoryTransaction",
    // Which filters were on, never their text: a recipient filter can hold a person's name.
    metadata: {
      rows: movements.length,
      truncated,
      type: params.group,
      category: params.category,
      searched: Boolean(params.search || params.recipient || params.destination),
    },
  });

  if (truncated) res.setHeader("X-Export-Truncated", "true");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="inventory-history-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send(`﻿${[HEADER.map(csvCell).join(","), ...movements.map(toLine)].join("\r\n")}`);
});

module.exports = { exportMovements };
