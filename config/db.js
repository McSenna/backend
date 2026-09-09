"use strict";

const mongoose = require("mongoose");
const logger = require("../utils/logger");

/**
 * Fail fast on the initial connect (the process cannot serve anything without
 * a database), but stay alive for connection drops afterwards: the driver
 * reconnects on its own, and in-flight requests surface as a 503 through the
 * global error handler rather than taking the whole server down.
 */
const connectDB = async () => {
  // Without this, a query issued while disconnected buffers for 30s before
  // failing. Ten seconds keeps the client's timeout meaningful.
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

  // Runtime connection faults arrive here. The message can contain the cluster
  // host, so only the classification is logged — and nothing is sent to a client.
  connection.on("error", (error) => {
    logger.error("MongoDB connection error", { errorName: error?.name });
  });

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
  } catch (error) {
    // Never log the error object itself: it embeds the connection string.
    logger.error("Initial MongoDB connection failed", {
      errorName: error?.name,
    });
    throw error;
  }
};

module.exports = connectDB;
