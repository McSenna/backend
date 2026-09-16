"use strict";

const { normalizePlatform } = require("../../config/platformAccess");

const ROLES = ["admin", "doctor", "midwife", "bhw", "resident"];

const normalizeRole = (role) => {
  const value = typeof role === "string" ? role.trim().toLowerCase() : "unknown";
  return ROLES.includes(value) ? value : "unknown";
};

const getClientIpAddress = (req) => {
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
};

const detectPlatform = (req) => {
  const userAgent = String(req?.headers?.["user-agent"] || "").toLowerCase();
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  return "Web";
};

const resolveLogClientPlatform = (req, explicitPlatform) =>
  normalizePlatform(explicitPlatform) ||
  normalizePlatform(req?.auth?.platform) ||
  normalizePlatform(req?.clientPlatform?.platform) ||
  "";

const parseUserAgent = (userAgent) => {
  const ua = String(userAgent || "");
  if (!ua) return { device: "Unknown device", browser: "Unknown browser" };

  let device = "Unknown device";
  if (/windows/i.test(ua)) device = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) device = "macOS";
  else if (/android/i.test(ua)) device = "Android";
  else if (/iphone/i.test(ua)) device = "iPhone";
  else if (/ipad/i.test(ua)) device = "iPad";
  else if (/linux/i.test(ua)) device = "Linux";

  const edgeMatch = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
  const firefoxMatch = ua.match(/Firefox\/([\d.]+)/);
  const safariMatch = ua.match(/Version\/([\d.]+).*Safari/);

  let browser = "Unknown browser";
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;

  return { device, browser };
};

module.exports = {
  normalizeRole,
  getClientIpAddress,
  detectPlatform,
  resolveLogClientPlatform,
  parseUserAgent,
};
