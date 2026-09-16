"use strict";

const mongoose = require("mongoose");
const logger = require("../../utils/logger");

const isUnsupportedTransaction = (error) =>
  error?.code === 20 ||
  /Transaction numbers are only allowed|replica set|not supported/i.test(error?.message || "");

const runInTransaction = async (fn) => {
  let session = null;

  try {
    session = await mongoose.startSession();
  } catch {
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
      logger.warn("Inventory transaction unsupported on this deployment; applying guarded writes");
      return fn(null);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => {});
  }
};

module.exports = { runInTransaction };
