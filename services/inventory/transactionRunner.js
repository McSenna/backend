"use strict";

const mongoose = require("mongoose");
const logger = require("../../utils/logger");
const { serviceUnavailable } = require("../../utils/AppError");

const isUnsupportedTransaction = (error) =>
  error?.code === 20 ||
  /Transaction numbers are only allowed|replica set|not supported/i.test(error?.message || "");

const runInTransaction = async (fn, { required = false } = {}) => {
  let session = null;

  try {
    session = await mongoose.startSession();
  } catch {
    if (required) throw serviceUnavailable("This security change requires a database transaction. Please try again later or contact the administrator.");
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
      if (required) throw serviceUnavailable("This security change requires MongoDB transactions. Ask the administrator to configure a replica set before trying again.");
      logger.warn("Inventory transaction unsupported on this deployment; applying guarded writes");
      return fn(null);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => {});
  }
};

module.exports = { runInTransaction };
