"use strict";

const { getModuleForAction, getLogTypeForAction } = require("./logClassification");
const { parseUserAgent } = require("./requestContext");

const serializeLog = (log) => {
  const user = log.userId && typeof log.userId === "object" ? log.userId : null;
  const { device, browser } = parseUserAgent(log.userAgent);

  return {
    _id: log._id,
    createdAt: log.createdAt,
    action: log.action,
    role: log.role,
    ipAddress: log.ipAddress || "unknown",
    platform: log.platform || "Web",
    clientPlatform: log.clientPlatform || "",
    resource: log.resource || "",
    resourceId: log.resourceId || "",
    description: log.description || "",
    success: log.success !== false,
    status: log.success !== false ? "Success" : "Failed",
    severity: log.severity || "info",
    module: getModuleForAction(log.action),
    logType: getLogTypeForAction(log.action),
    device,
    browser,
    userName: user?.fullname || (log.role === "system" ? "System" : "Unknown User"),
    userEmail: user?.email || "",
    userId: user?._id || log.userId || null,
  };
};

module.exports = { serializeLog };
