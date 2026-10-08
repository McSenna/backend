"use strict";

const { badRequest } = require("../../utils/AppError");
const { startOfDay } = require("../../utils/dateWindow");

// Refuses rather than rounds: 2.5 used to be stored as 2, `true` as 1, and
// numbers past the safe integer range lost precision.
const readQuantity = (raw) => {
  const quantity = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw badRequest("Quantity must be a whole number greater than zero.");
  }
  return quantity;
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

module.exports = { readQuantity, readReceipt };
