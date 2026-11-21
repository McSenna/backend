"use strict";

const crypto = require("crypto");

/**
 * Reads the device headers the apps send. Nothing here is trusted for a security
 * decision: the values are for display and investigation only.
 *   X-Device-Id    the install's random UUID
 *   X-Device-Hash  SHA-256 of the exact X-Device-Info JSON
 *   X-Device-Info  URI-encoded JSON, sent at app start and sign-in only
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_HEADER_LENGTH = 4096;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const PLATFORMS = ["android", "ios", "web"];
const DEVICE_TYPES = ["phone", "tablet", "desktop", "tv", "unknown"];
const SOURCES_BY_PLATFORM = { android: ["native"], ios: ["native"], web: ["ua-client-hints", "ua-string"] };

const STRING_LIMITS = {
  brand: 40,
  manufacturer: 40,
  modelRaw: 64,
  modelName: 64,
  deviceName: 64,
  osName: 32,
  osVersion: 32,
  browserName: 40,
  browserVersion: 32,
  appVersion: 32,
  buildNumber: 32,
};

const headerOf = (req, name) => {
  const value = req?.headers?.[name];
  return typeof value === "string" ? value.trim() : "";
};

const cleanString = (value, limit) => {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL_CHARS, "").trim().slice(0, limit);
  return text || null;
};

const cleanBoolean = (value) => (typeof value === "boolean" ? value : null);

const cleanInteger = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : null;

/** Keeps only known fields, of the right type and length. Null when the payload does not hang together. */
const sanitizeClientDevice = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const platform = PLATFORMS.includes(value.platform) ? value.platform : null;
  if (!platform || !SOURCES_BY_PLATFORM[platform].includes(value.source)) return null;

  const clean = {
    platform,
    source: value.source,
    deviceType: DEVICE_TYPES.includes(value.deviceType) ? value.deviceType : "unknown",
    deviceNameIsGeneric: value.deviceNameIsGeneric === true,
    isDevice: cleanBoolean(value.isDevice),
    isRooted: cleanBoolean(value.isRooted),
    apiLevel: cleanInteger(value.apiLevel, 1, 200),
    maxTouchPoints: cleanInteger(value.maxTouchPoints, 0, 32),
  };
  for (const [field, limit] of Object.entries(STRING_LIMITS)) clean[field] = cleanString(value[field], limit);
  return clean;
};

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const decodePayload = (encoded) => {
  if (!encoded || encoded.length > MAX_HEADER_LENGTH) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * The device the request names. `info` is set only when a full payload came
 * with it and its hash matches, so a stored record can never be overwritten
 * with different content under the same key.
 */
const readDeviceClaim = (req) => {
  const installId = headerOf(req, "x-device-id").toLowerCase();
  if (!UUID.test(installId)) return null;
  const hash = headerOf(req, "x-device-hash").toLowerCase();
  const claim = { installId, hash: SHA256.test(hash) ? hash : null, info: null };

  const raw = decodePayload(headerOf(req, "x-device-info"));
  if (!raw) return claim;
  const computed = sha256(raw);
  if (claim.hash && claim.hash !== computed) return claim;
  return { ...claim, hash: computed, info: sanitizeClientDevice(parseJson(raw)) };
};

module.exports = { readDeviceClaim, sanitizeClientDevice, sha256, DEVICE_TYPES, PLATFORMS };
