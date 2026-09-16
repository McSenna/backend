"use strict";

const mongoose = require("mongoose");
const logger = require("../utils/logger");

const connectDB = async () => {
  mongoose.set("bufferTimeoutMS", 10000);

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
      serverSelectionTimeoutMS: 10000,
    });
  } catch (error) {
    logger.error("Initial MongoDB connection failed", {
      errorName: error?.name,
    });
    throw error;
  }
};

module.exports = connectDB;
