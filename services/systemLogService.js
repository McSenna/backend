const SystemLog = require("../models/SystemLog");
const { normalizePlatform } = require("../config/platformAccess");

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

// Action prefixes are grouped into the modules/log-types the System Logs UI
// shows. New actions fall back to "System" / "System Event" rather than
// breaking the mapping.
const MODULE_RULES = [
  { test: /^LOGIN|^LOGOUT/, module: "Authentication", logType: "User Authentication" },
  {
    test: /^RESIDENT_WEB_LOGIN_BLOCKED$|^PLATFORM_ACCESS_DENIED$/,
    module: "Authentication",
    logType: "User Authentication",
  },
  { test: /^USER_/, module: "User Management", logType: "User Management" },
  { test: /^APPOINTMENT_/, module: "Appointments", logType: "Appointment Activity" },
  { test: /^RECORD_/, module: "Patients", logType: "Patient Records" },
  { test: /^SCHEDULE_/, module: "Scheduling", logType: "Schedule Management" },
  { test: /^INVENTORY_/, module: "Inventory", logType: "Inventory Management" },
];

function getModuleForAction(action) {
  const rule = MODULE_RULES.find((r) => r.test.test(String(action || "")));
  return rule ? rule.module : "System";
}

function getLogTypeForAction(action) {
  const rule = MODULE_RULES.find((r) => r.test.test(String(action || "")));
  return rule ? rule.logType : "System Event";
}

// Severity is a display concept layered on top of action + outcome: a failed
// attempt is always an error, destructive/security-sensitive actions are
// warnings, and everything else falls back to a plain create/approve
// "success" or a read-only "info" event.
const WARNING_ACTIONS = new Set([
  "RESIDENT_WEB_LOGIN_BLOCKED",
  "PLATFORM_ACCESS_DENIED",
  "USER_DELETED",
  "USER_ROLE_CHANGED",
  "USER_STATUS_CHANGED",
  "USER_UNVERIFIED",
  "APPOINTMENT_REJECTED",
  "APPOINTMENT_CANCELLED",
  "SCHEDULE_DELETED",
  "INVENTORY_ITEM_DEACTIVATED",
  "INVENTORY_ADJUSTED",
  "INVENTORY_EXPIRED_RECORDED",
]);

const SUCCESS_ACTIONS = new Set([
  "USER_CREATED",
  "USER_VERIFIED",
  "APPOINTMENT_APPROVED",
  "APPOINTMENT_CREATED",
  "RECORD_CREATED",
  "SCHEDULE_CREATED",
  "INVENTORY_ITEM_CREATED",
  "INVENTORY_STOCK_IN",
  "INVENTORY_STOCK_OUT",
]);

function deriveSeverity(action, success) {
  if (success === false) return "error";
  const normalized = String(action || "").toUpperCase();
  if (/FAILED/.test(normalized)) return "error";
  if (WARNING_ACTIONS.has(normalized)) return "warning";
  if (SUCCESS_ACTIONS.has(normalized)) return "success";
  return "info";
}

// Keys that must never leave the server in a log's metadata, even though the
// callers of createSystemLog should not be passing them in the first place.
const SENSITIVE_METADATA_KEYS = [
  "password",
  "newpassword",
  "oldpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessionsecret",
  "secret",
  "apikey",
  "otp",
  "otpcode",
  "pin",
];

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};

  const sanitizeValue = (value) => {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === "object") return sanitizeObject(value);
    return value;
  };

  function sanitizeObject(obj) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      const isSensitive = SENSITIVE_METADATA_KEYS.includes(
        key.toLowerCase().replace(/[_\s-]/g, "")
      );
      acc[key] = isSensitive ? "[REDACTED]" : sanitizeValue(value);
      return acc;
    }, {});
  }

  return sanitizeObject(metadata);
}

// A dependency-free user-agent reader — good enough to label the handful of
// desktop/mobile browsers this app actually sees without pulling in a full
// UA-parsing library for a details-panel nicety.
function parseUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return { device: "Unknown device", browser: "Unknown browser" };

  let device = "Unknown device";
  if (/windows/i.test(ua)) device = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) device = "macOS";
  else if (/android/i.test(ua)) device = "Android";
  else if (/iphone/i.test(ua)) device = "iPhone";
  else if (/ipad/i.test(ua)) device = "iPad";
  else if (/linux/i.test(ua)) device = "Linux";

  let browser = "Unknown browser";
  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
  const firefoxMatch = ua.match(/Firefox\/([\d.]+)/);
  const safariMatch = ua.match(/Version\/([\d.]+).*Safari/);

  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;

  return { device, browser };
}

/**
 * The authorization platform for a log entry.
 *
 * An explicit value wins (the login flow knows the platform it just decided
 * on); otherwise it comes from whatever the platform middleware resolved for
 * this request. Never guessed from the user agent — that is what the separate
 * `platform` device label is for.
 */
function resolveLogClientPlatform(req, explicitPlatform) {
  return (
    normalizePlatform(explicitPlatform) ||
    normalizePlatform(req?.auth?.platform) ||
    normalizePlatform(req?.clientPlatform?.platform) ||
    ""
  );
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
  clientPlatform,
}) {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) {
    return null;
  }

  const actor = user || (req && req.user) || {};
  const actorRole = normalizeRole(role || actor.role || (req && req.user && req.user.role) || "unknown");
  const actorUserId = actor._id || actor.userId || (req && req.user && req.user.userId) || null;
  const isSuccess = Boolean(success);

  const logData = {
    action: normalizedAction,
    role: actorRole,
    userId: actorUserId || null,
    ipAddress: getClientIpAddress(req),
    platform: detectPlatform(req),
    clientPlatform: resolveLogClientPlatform(req, clientPlatform),
    userAgent: String(req?.headers?.["user-agent"] || ""),
    resource: typeof resource === "string" ? resource : "",
    resourceId: typeof resourceId === "string" ? resourceId : resourceId ? String(resourceId) : "",
    description: typeof description === "string" ? description : String(description || ""),
    success: isSuccess,
    severity: deriveSeverity(normalizedAction, isSuccess),
    metadata: sanitizeMetadata(metadata),
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
  // Deduplicated: several action groups share one log type.
  LOG_TYPE_OPTIONS: [...new Set([...MODULE_RULES.map((r) => r.logType), "System Event"])],
};
