"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { seedAdmin } = require("./services/seedAdmin");
const { globalErrorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { attachRequestPlatform } = require("./middleware/platformMiddleware");
const { verifyTransport } = require("./services/mailer");

const app = express();

app.use(cors());

// Increase JSON/urlencoded body size limits to support base64 images.
// Oversized or malformed bodies reject here and are normalized to 413/400 by
// the global error handler instead of surfacing a body-parser stack trace.
const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || "10mb";
app.use(express.json({ limit: BODY_LIMIT }));
app.use(
  express.urlencoded({
    limit: BODY_LIMIT,
    extended: true,
  })
);

// Resolves which client platform every request came from (browser signals
// first, the client's own claim second) before any route reads it, so login,
// the authenticated guards and the audit log all agree on one value.
app.use(attachRequestPlatform);

const organizationRoutes = require("./routes/organizationRoutes");
const authRoutes = require("./routes/authRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const userRoutes = require("./routes/userRoutes");
const systemLogRoutes = require("./routes/systemLogRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");

app.get("/api/health", (_req, res) => {
  res.status(200).json({ success: true, message: "Service is running", data: {} });
});

app.use("/api", organizationRoutes);
app.use("/api", authRoutes);
app.use("/api", appointmentRoutes);
app.use("/api", notificationRoutes);
app.use("/api", userRoutes);
app.use("/api", systemLogRoutes);
app.use("/api", dashboardRoutes);
app.use("/api", inventoryRoutes);

// Unmatched routes must return the standard JSON envelope, not Express's
// default HTML error page — the mobile client only ever parses JSON.
app.use(notFoundHandler);

// Centralized error handling. Registered last so every route and middleware
// above can hand it a failure via next(error).
app.use(globalErrorHandler);

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    await seedAdmin();
    verifyTransport();
  } catch (error) {
    logger.error("Failed to start server", { errorName: error?.name });
    process.exit(1);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server running on port ${PORT}`);
  });

  // Last-resort safety nets. These exist to make a crash diagnosable, not to
  // substitute for handling errors where they occur: an unhandled rejection is
  // a bug in a route that skipped asyncHandler, and should be fixed there.
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
    // The process is in an undefined state after an uncaught exception; close
    // the listener so in-flight requests finish, then exit for the supervisor.
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 10000).unref();
  });

  const shutdown = (signal) => {
    logger.info(`Received ${signal}; shutting down`);
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
