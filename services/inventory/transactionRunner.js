"use strict";

const mongoose = require("mongoose");
const logger = require("../../utils/logger");
const { serviceUnavailable } = require("../../utils/AppError");

const isUnsupportedTransaction = (error) =>
  error?.code === 20 ||
  /Transaction numbers are only allowed|replica set|not supported/i.test(error?.message || "");

// Stock and its movement record must commit together, so no stock change runs without a transaction.
const STOCK_TRANSACTION = Object.freeze({
  required: true,
  unavailableMessage: "Stock changes need a database transaction, which is not available right now. Please try again later or contact the administrator.",
});

const SECURITY_MESSAGE = "This security change requires MongoDB transactions. Ask the administrator to configure a replica set before trying again.";

const runInTransaction = async (fn, { required = false, unavailableMessage = SECURITY_MESSAGE } = {}) => {
  let session = null;

  try {
    session = await mongoose.startSession();
  } catch {
    if (required) throw serviceUnavailable(unavailableMessage);
    return fn(null);
  }

  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (error) {
    if (isUnsupportedTransaction(error)) {
      if (required) throw serviceUnavailable(unavailableMessage);
      logger.warn("Inventory transaction unsupported on this deployment; applying guarded writes");
      return fn(null);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => {});
  }
};

module.exports = { runInTransaction, STOCK_TRANSACTION };
