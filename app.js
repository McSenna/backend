"use strict";

const express = require("express");
const cors = require("cors");

const { buildCorsOptions } = require("./config/cors");
const { globalErrorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { attachRequestPlatform } = require("./middleware/platformMiddleware");

const organizationRoutes = require("./routes/organizationRoutes");
const authRoutes = require("./routes/authRoutes");
const appointmentRoutes = require("./routes/appointmentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const userRoutes = require("./routes/userRoutes");
const profileRoutes = require("./routes/profileRoutes");
const systemLogRoutes = require("./routes/systemLogRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");

function createApp() {
  const app = express();

  app.use(cors(buildCorsOptions()));

  const bodyLimit = process.env.REQUEST_BODY_LIMIT || "10mb";
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

  app.use(attachRequestPlatform);

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ success: true, message: "Service is running", data: {} });
  });

  app.use("/api", organizationRoutes);
  app.use("/api", authRoutes);
  app.use("/api", appointmentRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api", userRoutes);
  app.use("/api", profileRoutes);
  app.use("/api", systemLogRoutes);
  app.use("/api", dashboardRoutes);
  app.use("/api", inventoryRoutes);

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

module.exports = { createApp };
