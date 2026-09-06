const SystemLog = require("../models/SystemLog");

const VALID_ACTIONS = new Set(require("../models/SystemLog").VALID_ACTIONS || []);

function normalizeRole(role) {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "unknown";
  if (["admin", "doctor", "midwife", "bhw", "resident"].includes(value)) {
    return value;
  }
  return "unknown";
}

function normalizeAction(action) {
  const value = typeof action === "string" ? action.trim().toUpperCase() : "";
  return VALID_ACTIONS.has(value) ? value : null;
}

function getClientIpAddress(req) {
  if (!req) return "unknown";

  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0]).trim();
  }

  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
  if (socketIp && socketIp !== "::1" && socketIp !== "::ffff:127.0.0.1") {
    return socketIp;
  }

  return "unknown";
}

function detectPlatform(req) {
  const userAgent = String(req?.headers?.["user-agent"] || "").toLowerCase();

  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  return "Web";
}

async function createSystemLog({
  req,
  action,
  user,
  role,
  metadata = {},
  description = "",
  resource = "",
  resourceId = "",
  success = true,
}) {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) {
    return null;
  }

  const actor = user || (req && req.user) || {};
  const actorRole = normalizeRole(role || actor.role || (req && req.user && req.user.role) || "unknown");
  const actorUserId = actor._id || actor.userId || (req && req.user && req.user.userId) || null;

  const logData = {
    action: normalizedAction,
    role: actorRole,
    userId: actorUserId || null,
    ipAddress: getClientIpAddress(req),
    platform: detectPlatform(req),
    resource: typeof resource === "string" ? resource : "",
    resourceId: typeof resourceId === "string" ? resourceId : resourceId ? String(resourceId) : "",
    description: typeof description === "string" ? description : String(description || ""),
    success: Boolean(success),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  };

  try {
    const log = await SystemLog.create(logData);
    return log;
  } catch (error) {
    console.error("Failed to create system log:", error.message || error);
    return null;
  }
}

module.exports = {
  createSystemLog,
  normalizeRole,
  normalizeAction,
  getClientIpAddress,
  detectPlatform,
};
