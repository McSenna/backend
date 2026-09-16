"use strict";

const SystemLog = require("../models/SystemLog");
const logger = require("../utils/logger");
const {
  normalizeRole,
  getClientIpAddress,
  detectPlatform,
  resolveLogClientPlatform,
  parseUserAgent,
} = require("./systemLog/requestContext");
const {
  normalizeAction,
  MODULE_RULES,
  getModuleForAction,
  getLogTypeForAction,
  deriveSeverity,
} = require("./systemLog/logClassification");
const { sanitizeMetadata } = require("./systemLog/metadataSanitizer");

const asText = (value) => (typeof value === "string" ? value : String(value || ""));

const resolveActor = ({ req, user, role }) => {
  const actor = user || (req && req.user) || {};
  return {
    role: normalizeRole(role || actor.role || (req && req.user && req.user.role) || "unknown"),
    userId: actor._id || actor.userId || (req && req.user && req.user.userId) || null,
  };
};

const createSystemLog = async ({
  req,
  action,
  user,
  role,
  metadata = {},
  description = "",
  resource = "",
  resourceId = "",
  success = true,
  clientPlatform,
}) => {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return null;

  const actor = resolveActor({ req, user, role });
  const isSuccess = Boolean(success);

  const logData = {
    action: normalizedAction,
    role: actor.role,
    userId: actor.userId || null,
    ipAddress: getClientIpAddress(req),
    platform: detectPlatform(req),
    clientPlatform: resolveLogClientPlatform(req, clientPlatform),
    userAgent: String(req?.headers?.["user-agent"] || ""),
    resource: typeof resource === "string" ? resource : "",
    resourceId: typeof resourceId === "string" ? resourceId : resourceId ? String(resourceId) : "",
    description: asText(description),
    success: isSuccess,
    severity: deriveSeverity(normalizedAction, isSuccess),
    metadata: sanitizeMetadata(metadata),
  };

  try {
    return await SystemLog.create(logData);
  } catch (error) {
    logger.error("Failed to create system log", {
      errorName: error?.name,
      errorMessage: error?.message || String(error),
    });
    return null;
  }
};

module.exports = {
  createSystemLog,
  resolveLogClientPlatform,
  normalizeRole,
  normalizeAction,
  getClientIpAddress,
  detectPlatform,
  getModuleForAction,
  getLogTypeForAction,
  deriveSeverity,
  sanitizeMetadata,
  parseUserAgent,
  MODULE_RULES,
  LOG_TYPE_OPTIONS: [...new Set([...MODULE_RULES.map((rule) => rule.logType), "System Event"])],
};
