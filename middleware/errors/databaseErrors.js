"use strict";

const DUPLICATE_FIELD_LABELS = Object.freeze({
  email: "This email address is already registered.",
  contactNumber: "This contact number is already registered.",
  username: "This username is already taken.",
  date: "A record already exists for this date.",
});

const UNAVAILABLE_ERROR_NAMES = [
  "MongoNetworkError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoNetworkTimeoutError",
  "MongoTimeoutError",
];

const isDatabaseUnavailableError = (err) => {
  if (UNAVAILABLE_ERROR_NAMES.includes(String(err?.name || ""))) return true;

  const message = String(err?.message || "");
  return (
    message.includes("buffering timed out") ||
    message.includes("Client must be connected before running operations")
  );
};

const duplicateFieldLabel = (err) => {
  const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || "value";
  return { field, label: DUPLICATE_FIELD_LABELS[field] || `${field} already exists.` };
};

module.exports = { DUPLICATE_FIELD_LABELS, isDatabaseUnavailableError, duplicateFieldLabel };
