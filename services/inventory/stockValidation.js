"use strict";

const { badRequest } = require("../../utils/AppError");
const { startOfDay } = require("../../utils/dateWindow");
const { ISSUE_TYPES } = require("../../config/inventoryMovements");

// Refuses rather than rounds: 2.5 used to be stored as 2, `true` as 1, and
// numbers past the safe integer range lost precision.
const readQuantity = (raw) => {
  const quantity = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw badRequest("Quantity must be a whole number greater than zero.");
  }
  return quantity;
};

const cleanText = (value, maxLength) => String(value ?? "").trim().slice(0, maxLength);

const readRequiredReason = (payload, message) => {
  const reason = cleanText(payload.reason, 300);
  if (!reason) throw badRequest(message);
  return reason;
};

// A release is only traceable if it says where the stock went and who took it.
const readDestination = (payload, type) => {
  const destination = {
    destinationName: cleanText(payload.destinationName, 200),
    destinationDepartment: cleanText(payload.destinationDepartment, 120),
    destinationLocation: cleanText(payload.destinationLocation, 200),
    recipient: cleanText(payload.recipient, 200),
    recipientDesignation: cleanText(payload.recipientDesignation, 120),
    recipientDepartment: cleanText(payload.recipientDepartment, 120),
  };

  if (ISSUE_TYPES.includes(type)) {
    if (!destination.destinationName) throw badRequest("Add where this stock is going, like a ward or facility.");
    if (!destination.recipient) throw badRequest("Add the name of the person or department receiving this stock.");
  }
  return destination;
};

const readReceipt = (payload) => {
  const batchNumber = String(payload.batchNumber || "").trim();
  if (!batchNumber) throw badRequest("Batch / Lot number is required.");

  const expiryDate = payload.expiryDate ? new Date(payload.expiryDate) : null;
  if (payload.expiryDate && Number.isNaN(expiryDate.getTime())) {
    throw badRequest("Expiry date is not a valid date.");
  }
  if (expiryDate && startOfDay(expiryDate) < startOfDay(new Date())) {
    throw badRequest("Expiry date cannot be in the past. Expired stock must not be received.");
  }

  const receivedDate = payload.receivedDate ? new Date(payload.receivedDate) : new Date();
  if (Number.isNaN(receivedDate.getTime())) {
    throw badRequest("Date received is not a valid date.");
  }

  return { batchNumber, expiryDate, receivedDate };
};

module.exports = { readQuantity, readReceipt, readDestination, readRequiredReason, cleanText };
