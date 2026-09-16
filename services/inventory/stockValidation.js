"use strict";

const { badRequest } = require("../../utils/AppError");
const { startOfDay } = require("../../utils/dateWindow");

const readQuantity = (raw) => {
  const quantity = Math.trunc(Number(raw));
  if (!Number.isFinite(quantity) || quantity <= 0) {
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
