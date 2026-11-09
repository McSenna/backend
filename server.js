"use strict";

require("dotenv").config();

const http = require("http");

process.env.TZ = process.env.APP_TIMEZONE || "Asia/Manila";

const { createApp } = require("./app");
const { validateEnv } = require("./config/env");
const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { seedAdmin } = require("./services/seedAdmin");
const { verifyTransport } = require("./services/mailer");
const { migrateMedicalRecordSources } = require("./services/medicalRecord/sourceMigration");
const { initializeResidentIdentity } = require("./services/masterList/residentIdentityStartup");
const { startRealtime, stopRealtime } = require("./realtime");

const { startImmunizationReminderScheduler } = require("./services/immunization/reminderWorker");
let stopImmunizationReminders = () => {};
let stopPushWorker = () => {};

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  validateEnv();
  await connectDB();
  await initializeResidentIdentity();
  await migrateMedicalRecordSources();
  await require("./services/immunization/initialize").initializeImmunization();
  await require("./services/residentWebAccess").initializeResidentWebAccess();
  await require("./services/residentWebAccess").reportDesignatedAdmin();
  await Promise.all([require("./models/PushDevice").createIndexes(), require("./models/PushDelivery").createIndexes()]);
  await seedAdmin();
  verifyTransport();
}

function attachShutdownHandlers(server) {
  const shutdown = (signal) => {
    logger.info(`Received ${signal}; shutting down`);
    // Open sockets would keep server.close() waiting until the timeout below.
    stopImmunizationReminders();
    stopPushWorker();
    void stopRealtime();
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

  // Socket.IO shares this server, so REST and realtime use one port and one TLS setup.
  const server = http.createServer(createApp());
  startRealtime(server);
  stopImmunizationReminders = startImmunizationReminderScheduler();
  stopPushWorker = require("./services/notification/pushWorker").startPushWorker();
  server.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server running on port ${PORT}`);
  });

  attachShutdownHandlers(server);
}

startServer();
