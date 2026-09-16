"use strict";

require("dotenv").config();

const { createApp } = require("./app");
const { validateEnv } = require("./config/env");
const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { seedAdmin } = require("./services/seedAdmin");
const { verifyTransport } = require("./services/mailer");

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  validateEnv();
  await connectDB();
  await seedAdmin();
  verifyTransport();
}

function attachShutdownHandlers(server) {
  const shutdown = (signal) => {
    logger.info(`Received ${signal}; shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", {
      errorName: reason?.name,
      errorMessage: reason?.message,
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception — shutting down", {
      errorName: error?.name,
      errorMessage: error?.message,
    });
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}

async function startServer() {
  try {
    await bootstrap();
  } catch (error) {
    logger.error("Failed to start server", { errorName: error?.name });
    process.exit(1);
  }

  const server = createApp().listen(PORT, "0.0.0.0", () => {
    logger.info(`Server running on port ${PORT}`);
  });

  attachShutdownHandlers(server);
}

startServer();
