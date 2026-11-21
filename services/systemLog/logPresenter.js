"use strict";

const { getModuleForAction, getLogTypeForAction } = require("./logClassification");
const { parseUserAgent } = require("./requestContext");

const DEVICE_FIELDS = [
  "installId", "platform", "deviceType", "brand", "manufacturer", "modelRaw", "modelName", "deviceName",
  "deviceNameIsGeneric", "osName", "osVersion", "apiLevel", "browserName", "browserVersion", "inAppBrowser",
  "appVersion", "buildNumber", "isDevice", "isRooted", "source", "confidence", "capturedAt", "purgedAt",
];

/** The stored snapshot, field by field (never the raw subdocument), plus the request's User-Agent. */
const serializeDevice = (log) => {
  const device = log.device;
  if (!device) return null;
  const out = { userAgent: log.userAgent || null, mismatch: device.mismatch ?? [], fieldConfidence: device.fieldConfidence ?? null };
  for (const field of DEVICE_FIELDS) out[field] = device[field] ?? null;
  return out;
};

const joined = (...parts) => parts.filter(Boolean).join(" ").trim();

/** One-line texts for the CSV and older screens: "samsung SM-S918B · Android 14", "Chrome 131". */
const deviceTexts = (log) => {
  const device = log.device;
  if (!device?.source || device.source === "none") return parseUserAgent(log.userAgent);
  const model = device.modelName || device.modelRaw;
  const hardware = joined(device.brand, model) || "Model not available";
  const os = joined(device.osName, device.osVersion);
  const browser = joined(device.inAppBrowser ? `${device.inAppBrowser} in-app` : device.browserName, device.browserVersion);
  const app = device.appVersion ? `App ${device.appVersion}` : "";
  return {
    device: [hardware, os].filter(Boolean).join(" · "),
    browser: browser || app || "Unknown browser",
  };
};

const serializeLog = (log) => {
  const user = log.userId && typeof log.userId === "object" ? log.userId : null;
  const { device, browser } = deviceTexts(log);

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
    deviceInfo: serializeDevice(log),
    userName: user?.fullname || (log.role === "system" ? "System" : "Unknown User"),
    userEmail: user?.email || "",
    userId: user?._id || log.userId || null,
  };
};

module.exports = { serializeLog };
