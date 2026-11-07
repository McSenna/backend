"use strict";

const mongoose = require("mongoose");
const logger = require("../utils/logger");

const timeoutSetting = (key, fallback) => {
  const value = process.env[key] === undefined ? fallback : Number(process.env[key]);
  if (!Number.isInteger(value) || value < 1 || value > 120000) throw new Error(`Invalid ${key}: expected milliseconds from 1 to 120000`);
  return value;
};

const connectDB = async () => {
  mongoose.set("bufferCommands", false);

  const connection = mongoose.connection;

  connection.on("connected", () => {
    logger.info("MongoDB connected");
  });

  connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected; requests will fail until it reconnects");
  });

  connection.on("reconnected", () => {
    logger.info("MongoDB reconnected");
  });

  connection.on("error", (error) => {
    logger.error("MongoDB connection error", { errorName: error?.name });
  });

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: timeoutSetting("DB_SELECTION_TIMEOUT_MS", 5000),
      connectTimeoutMS: timeoutSetting("DB_CONNECT_TIMEOUT_MS", 5000),
      waitQueueTimeoutMS: timeoutSetting("DB_POOL_WAIT_TIMEOUT_MS", 2000),
      socketTimeoutMS: timeoutSetting("DB_SOCKET_TIMEOUT_MS", 5000),
    });
  } catch (error) {
    logger.error("Initial MongoDB connection failed", {
      errorName: error?.name,
    });
    throw error;
  }
};

module.exports = connectDB;
