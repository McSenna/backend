"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildDeviceSnapshot, noDeviceSnapshot } = require("../../services/device/deviceSnapshot");
const { readDeviceClaim, sanitizeClientDevice, sha256 } = require("../../services/device/clientDevicePayload");

const INSTALL_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

const claimOf = (info) => ({ installId: INSTALL_ID, hash: "a".repeat(64), info: sanitizeClientDevice(info) });

const nativeAndroid = {
  platform: "android", source: "native", deviceType: "phone", brand: "samsung", manufacturer: "samsung",
  modelRaw: "SM-S918B", modelName: null, deviceName: "Galaxy S23 Ultra", osName: "Android", osVersion: "14",
  appVersion: "1.0.1", buildNumber: null, isDevice: true, isRooted: false, apiLevel: 34,
};

test("native Android: real brand and model code, high confidence", () => {
  const snap = buildDeviceSnapshot({ claim: claimOf(nativeAndroid), userAgent: "okhttp/4.12.0", headers: {} });
  assert.deepEqual([snap.platform, snap.brand, snap.brandKey, snap.modelRaw, snap.source, snap.confidence], ["android", "samsung", "samsung", "SM-S918B", "native", "high"]);
  assert.deepEqual(snap.fieldConfidence, { model: "high", os: "high", browser: "none" });
  assert.equal(snap.installId, INSTALL_ID);
  assert.deepEqual(snap.mismatch, []);
});

test("native iOS with generic name keeps the flag", () => {
  const info = { platform: "ios", source: "native", deviceType: "phone", brand: "Apple", modelRaw: "iPhone17,1", modelName: "iPhone 16 Pro", deviceName: "iPhone", deviceNameIsGeneric: true, osName: "iOS", osVersion: "18.1" };
  const snap = buildDeviceSnapshot({ claim: claimOf(info), userAgent: "MaslogCare/1 CFNetwork/1568.200.51 Darwin/24.1.0", headers: {} });
  assert.deepEqual([snap.modelRaw, snap.modelName, snap.deviceNameIsGeneric, snap.confidence], ["iPhone17,1", "iPhone 16 Pro", true, "high"]);
});

test("native claim sent from a desktop browser is low confidence", () => {
  const snap = buildDeviceSnapshot({ claim: claimOf(nativeAndroid), userAgent: CHROME_WINDOWS, headers: {}, hasBrowserSignal: true });
  assert.equal(snap.confidence, "low");
  assert.ok(snap.mismatch.includes("native-claim-from-browser"));
});

test("native Android claim over an iOS HTTP stack is low confidence", () => {
  const snap = buildDeviceSnapshot({ claim: claimOf(nativeAndroid), userAgent: "MaslogCare/1 CFNetwork/1568.200.51 Darwin/24.1.0", headers: {} });
  assert.deepEqual(snap.mismatch, ["platform"]);
  assert.equal(snap.confidence, "low");
});

const hintsAndroid = { platform: "web", source: "ua-client-hints", deviceType: "phone", modelRaw: "Pixel 7", osName: "Android", osVersion: "14", browserName: "Chrome", browserVersion: "131" };

test("Chrome on Android with Client Hints: real model, high", () => {
  const snap = buildDeviceSnapshot({ claim: claimOf(hintsAndroid), userAgent: CHROME_ANDROID, headers: { "sec-ch-ua-platform": '"Android"' } });
  assert.deepEqual([snap.modelRaw, snap.osVersion, snap.source, snap.confidence], ["Pixel 7", "14", "ua-client-hints", "high"]);
  assert.equal(snap.brand, null, "Client Hints give no brand, and none is guessed from the model");
});

test("Client Hints without a model (desktop): medium, model none", () => {
  const info = { platform: "web", source: "ua-client-hints", deviceType: "desktop", modelRaw: null, osName: "Windows", osVersion: "11", browserName: "Chrome", browserVersion: "131" };
  const snap = buildDeviceSnapshot({ claim: claimOf(info), userAgent: CHROME_WINDOWS, headers: { "sec-ch-ua-platform": '"Windows"' } });
  assert.deepEqual([snap.confidence, snap.fieldConfidence.model, snap.osVersion], ["medium", "none", "11"]);
});

test("Client Hints that disagree with the request's UA are low", () => {
  const snap = buildDeviceSnapshot({ claim: claimOf(hintsAndroid), userAgent: CHROME_WINDOWS, headers: {} });
  assert.equal(snap.confidence, "low");
  assert.ok(snap.mismatch.includes("os"));
});

test("Client Hints from a non-Chromium UA are low", () => {
  const info = { ...hintsAndroid, osName: "Windows", deviceType: "desktop", modelRaw: null };
  const snap = buildDeviceSnapshot({ claim: claimOf(info), userAgent: FIREFOX_WINDOWS, headers: {} });
  assert.ok(snap.mismatch.includes("browser-engine"));
});

test("Client Hints that contradict sec-ch-ua-platform are low", () => {
  const snap = buildDeviceSnapshot({ claim: claimOf(hintsAndroid), userAgent: CHROME_ANDROID, headers: { "sec-ch-ua-platform": '"Windows"' } });
  assert.ok(snap.mismatch.includes("client-hints-header"));
});

test("Safari on iPhone: 'iPhone' with model unavailable, never invented", () => {
  const info = { platform: "web", source: "ua-string", deviceType: "unknown", maxTouchPoints: 5 };
  const snap = buildDeviceSnapshot({ claim: claimOf(info), userAgent: SAFARI_IPHONE, headers: {} });
  assert.deepEqual([snap.brand, snap.modelRaw, snap.modelName, snap.deviceType, snap.osName], ["Apple", null, null, "phone", "iOS"]);
  assert.deepEqual([snap.source, snap.confidence, snap.fieldConfidence.model, snap.fieldConfidence.os], ["ua-string", "medium", "none", "medium"]);
});

test("iPad in desktop mode is a tablet on iPadOS, not a Mac", () => {
  const info = { platform: "web", source: "ua-string", maxTouchPoints: 5 };
  const snap = buildDeviceSnapshot({ claim: claimOf(info), userAgent: SAFARI_MAC, headers: {} });
  assert.deepEqual([snap.deviceType, snap.osName, snap.modelRaw], ["tablet", "iPadOS", null]);
  const mac = buildDeviceSnapshot({ claim: claimOf({ ...info, maxTouchPoints: 0 }), userAgent: SAFARI_MAC, headers: {} });
  assert.deepEqual([mac.deviceType, mac.osName], ["desktop", "macOS"]);
});

test("no client report: server reading, low", () => {
  const snap = buildDeviceSnapshot({ claim: null, userAgent: FIREFOX_WINDOWS, headers: {} });
  assert.deepEqual([snap.source, snap.confidence, snap.platform, snap.browserName, snap.installId], ["server-ua", "low", "web", "Firefox", null]);
});

test("no request at all: source none", () => {
  const snap = noDeviceSnapshot();
  assert.deepEqual([snap.source, snap.platform, snap.confidence], ["none", "unknown", "low"]);
});

test("payload sanitizer: unknown fields dropped, strings cut, bad combos refused", () => {
  const clean = sanitizeClientDevice({ ...nativeAndroid, imei: "123", modelRaw: `SM-${"9".repeat(200)}\u0007`, isRooted: "yes" });
  assert.equal(clean.imei, undefined);
  assert.equal(clean.modelRaw.length, 64);
  assert.equal(clean.isRooted, null);
  assert.equal(sanitizeClientDevice({ platform: "web", source: "native" }), null);
  assert.equal(sanitizeClientDevice({ platform: "windows", source: "ua-string" }), null);
  assert.equal(sanitizeClientDevice([1, 2]), null);
  assert.equal(sanitizeClientDevice("x"), null);
});

const requestWith = (headers) => ({ headers });

test("claim: full payload accepted only when its hash matches", () => {
  const json = JSON.stringify({ ...nativeAndroid, deviceName: "Juan’s phone" });
  const headers = { "x-device-id": INSTALL_ID, "x-device-hash": sha256(json), "x-device-info": encodeURIComponent(json) };
  const claim = readDeviceClaim(requestWith(headers));
  assert.equal(claim.info.deviceName, "Juan’s phone");
  assert.equal(claim.hash, sha256(json));

  const tampered = readDeviceClaim(requestWith({ ...headers, "x-device-hash": "b".repeat(64) }));
  assert.equal(tampered.info, null);
});

test("claim: compact headers, bad id, bad encoding", () => {
  const compact = readDeviceClaim(requestWith({ "x-device-id": INSTALL_ID, "x-device-hash": "c".repeat(64) }));
  assert.deepEqual(compact, { installId: INSTALL_ID, hash: "c".repeat(64), info: null });
  assert.equal(readDeviceClaim(requestWith({ "x-device-id": "not-a-uuid" })), null);
  assert.equal(readDeviceClaim(requestWith({})), null);
  const broken = readDeviceClaim(requestWith({ "x-device-id": INSTALL_ID, "x-device-info": "%E0%A4%A" }));
  assert.equal(broken.info, null);
  const oversized = readDeviceClaim(requestWith({ "x-device-id": INSTALL_ID, "x-device-info": "a".repeat(5000) }));
  assert.equal(oversized.info, null);
});
