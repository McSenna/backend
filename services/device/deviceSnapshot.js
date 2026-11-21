"use strict";

const { parseUserAgentDetails } = require("./userAgentParser");

/**
 * The device written onto an audit entry. The client's report is used where
 * the platform can vouch for it; everything else comes from the server's own
 * reading of the User-Agent. A report the request contradicts is kept, but
 * marked low confidence with the reasons.
 *
 * Confidence: native = high; Client Hints with a model = high, without = medium;
 * User-Agent only = medium (model low); server reading alone = low; any mismatch = low.
 */

const DESKTOP_FAMILIES = new Set(["windows", "macos", "linux", "chromeos"]);
const OS_FAMILIES = [
  [/^android/i, "android"],
  [/^(ios|ipados)/i, "ios"],
  [/^windows/i, "windows"],
  [/^mac/i, "macos"],
  [/^chrome ?os/i, "chromeos"],
  [/^linux/i, "linux"],
];

const familyOf = (osName) => OS_FAMILIES.find(([pattern]) => pattern.test(osName || ""))?.[1] ?? null;

const brandKeyOf = (brand) => {
  const key = String(brand || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return key || null;
};

const platformOfKind = { "native-android": "android", "native-ios": "ios", browser: "web" };

/** sec-ch-ua-platform arrives quoted: "\"Windows\"". */
const readHintPlatform = (headers) => {
  const value = typeof headers?.["sec-ch-ua-platform"] === "string" ? headers["sec-ch-ua-platform"] : "";
  return familyOf(value.replace(/"/g, "").trim());
};

const findMismatches = ({ client, server, hintFamily, hasBrowserSignal }) => {
  const reasons = [];
  if (client.source === "native") {
    if (hasBrowserSignal || (server.kind === "browser" && DESKTOP_FAMILIES.has(server.osFamily))) reasons.push("native-claim-from-browser");
    if (client.platform === "android" && server.kind === "native-ios") reasons.push("platform");
    if (client.platform === "ios" && server.kind === "native-android") reasons.push("platform");
    return reasons;
  }
  if (server.kind === "native-android" || server.kind === "native-ios") reasons.push("platform");
  const clientFamily = familyOf(client.osName);
  if (clientFamily && server.osFamily && clientFamily !== server.osFamily) reasons.push("os");
  if (clientFamily && hintFamily && clientFamily !== hintFamily) reasons.push("client-hints-header");
  // Only Chromium-engine browsers implement Client Hints.
  if (client.source === "ua-client-hints" && server.engine && server.engine !== "blink") reasons.push("browser-engine");
  return reasons;
};

const level = (value, when) => (value ? when : "none");

const fromServer = (server) => ({
  platform: platformOfKind[server.kind] ?? "unknown",
  deviceType: server.deviceType,
  brand: server.brand,
  manufacturer: null,
  modelRaw: server.modelRaw,
  modelName: null,
  deviceName: null,
  deviceNameIsGeneric: false,
  osName: server.osName,
  osVersion: server.osVersion,
  browserName: server.browserName,
  browserVersion: server.browserVersion,
  inAppBrowser: server.inAppBrowser,
  appVersion: null,
  buildNumber: null,
  isDevice: null,
  isRooted: null,
  source: "server-ua",
  fieldConfidence: { model: level(server.modelRaw, "low"), os: level(server.osName, "medium"), browser: level(server.browserName, "medium") },
  confidence: "low",
});

// maxTouchPoints only answers the iPad question for browsers; it is not stored.
const fromNative = ({ maxTouchPoints: _unused, ...client }) => ({
  ...fromServer({ kind: "unknown", deviceType: "unknown" }),
  ...client,
  browserName: null,
  browserVersion: null,
  inAppBrowser: null,
  source: "native",
  fieldConfidence: { model: level(client.modelRaw, "high"), os: level(client.osName, "high"), browser: "none" },
  confidence: "high",
});

const fromClientHints = (client, server) => ({
  ...fromServer(server),
  deviceType: client.deviceType !== "unknown" ? client.deviceType : server.deviceType,
  modelRaw: client.modelRaw,
  osName: client.osName ?? server.osName,
  osVersion: client.osVersion,
  browserName: client.browserName ?? server.browserName,
  browserVersion: client.browserVersion ?? server.browserVersion,
  source: "ua-client-hints",
  fieldConfidence: { model: level(client.modelRaw, "high"), os: level(client.osName, "high"), browser: level(client.browserName, "high") },
  confidence: client.modelRaw ? "high" : "medium",
});

/** iPadOS Safari asks for desktop pages and sends a Mac User-Agent; a Mac has no touch screen. */
const isIpadInDesktopMode = (client, server) => server.osFamily === "macos" && (client.maxTouchPoints ?? 0) > 1;

const fromUserAgentString = (client, server) => {
  const base = { ...fromServer(server), source: "ua-string", confidence: "medium" };
  if (!isIpadInDesktopMode(client, server)) return base;
  return { ...base, deviceType: "tablet", osName: "iPadOS", osVersion: null };
};

const fromClient = (client, server) => {
  if (client.source === "native") return fromNative(client);
  if (client.source === "ua-client-hints") return fromClientHints(client, server);
  return fromUserAgentString(client, server);
};

/** Pure: no database, no clock beyond `now`. */
const buildDeviceSnapshot = ({ claim, userAgent, headers, hasBrowserSignal = false, now = new Date() }) => {
  const server = parseUserAgentDetails(userAgent);
  const client = claim?.info ?? null;
  const snapshot = client ? fromClient(client, server) : fromServer(server);
  const mismatch = client ? findMismatches({ client, server, hintFamily: readHintPlatform(headers), hasBrowserSignal }) : [];

  return {
    installId: claim?.installId ?? null,
    ...snapshot,
    brandKey: brandKeyOf(snapshot.brand),
    confidence: mismatch.length > 0 ? "low" : snapshot.confidence,
    mismatch,
    capturedAt: now,
  };
};

/** For an entry no request caused (a scheduled job): no device to describe. */
const noDeviceSnapshot = (now = new Date()) => ({
  ...fromServer(parseUserAgentDetails("")),
  installId: null,
  brandKey: null,
  source: "none",
  mismatch: [],
  capturedAt: now,
});

module.exports = { buildDeviceSnapshot, noDeviceSnapshot, brandKeyOf };
