"use strict";

// Device details on audit entries, through the real app: full report, compact headers,
// no headers, broken headers, admin-only reading, filters, retention and the backfill.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env"), quiet: true });
process.env.EMAIL_PROVIDER = "mock";
process.env.DEVICE_RETENTION_DISABLED = "true";
const http = require("http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const User = require("../../models/User");
const SystemLog = require("../../models/SystemLog");
const Device = require("../../models/Device");
const { _cache: deviceCache } = require("../../services/device/deviceRegistry");
const { purgeExpiredDeviceDetails } = require("../../services/device/deviceRetention");
const { runMigration } = require("../../scripts/migrations/systemLogDevices");
const { sha256 } = require("../../services/device/clientDevicePayload");

const PASSWORD = "Synthetic1!";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const ANDROID_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const IPHONE_WEB_ID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const NATIVE_ANDROID = {
  platform: "android", source: "native", deviceType: "phone", brand: "samsung", manufacturer: "samsung",
  modelRaw: "SM-S918B", modelName: null, deviceName: "Galaxy S23 Ultra", deviceNameIsGeneric: false,
  osName: "Android", osVersion: "14", apiLevel: 34, appVersion: "1.0.1", buildNumber: null, isDevice: true, isRooted: false,
};

let mongod;
let server;
let baseUrl;
let failed = 0;

const check = (name, condition, detail = "") => {
  if (!condition) failed += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` — ${detail}` : ""}`);
};

const fullHeaders = (installId, info) => {
  const json = JSON.stringify(info);
  return { "X-Device-Id": installId, "X-Device-Hash": sha256(json), "X-Device-Info": encodeURIComponent(json) };
};

const request = (path, { method = "GET", token, body, headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const all = { "Content-Type": "application/json", "X-Client-Platform": "web", "User-Agent": FIREFOX_WINDOWS, ...headers };
    if (token) all.Authorization = `Bearer ${token}`;
    const req = http.request(new URL(`${baseUrl}${path}`), { method, headers: all }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

const login = (email, headers, password = PASSWORD) => request("/login", { method: "POST", body: { email, password }, headers });
const latestLog = (action) => SystemLog.findOne({ action }).sort({ createdAt: -1, _id: -1 }).lean();
const waitForDevice = async (installId) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await Device.exists({ installId })) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
};

const makeUser = (email, role) =>
  User.create({
    fullname: `Test ${role}`, email, password: PASSWORD, role, verified: true, status: "approved",
    phone: "09170000000", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Test address",
  });

async function run() {
  await makeUser("device.admin@maslogcare.test", "admin");
  await makeUser("device.doctor@maslogcare.test", "doctor");

  const native = { ...fullHeaders(ANDROID_ID, NATIVE_ANDROID), "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.12.0" };
  const signedIn = await login("device.admin@maslogcare.test", native);
  check("Native sign-in succeeds", signedIn.status === 200, JSON.stringify(signedIn.body));
  const nativeLog = await latestLog("LOGIN");
  check("Native Android logs real brand and model code", nativeLog?.device?.brand === "samsung" && nativeLog?.device?.modelRaw === "SM-S918B", JSON.stringify(nativeLog?.device));
  check("Native report is high confidence", nativeLog?.device?.source === "native" && nativeLog?.device?.confidence === "high");
  check("The full report is stored once for compact requests", await waitForDevice(ANDROID_ID));

  deviceCache.clear();
  const compact = { "X-Device-Id": ANDROID_ID, "X-Device-Hash": native["X-Device-Hash"], "X-Client-Platform": "mobile", "User-Agent": "okhttp/4.12.0" };
  const wrong = await login("device.admin@maslogcare.test", compact, "Wrong-password1!");
  check("A failed sign-in is refused as before", wrong.status === 401 || wrong.status === 400, String(wrong.status));
  const failedLog = await latestLog("LOGIN_FAILED");
  check("Compact headers resolve the stored report from the database", failedLog?.device?.modelRaw === "SM-S918B" && failedLog?.device?.source === "native", JSON.stringify(failedLog?.device));

  const safari = { ...fullHeaders(IPHONE_WEB_ID, { platform: "web", source: "ua-string", deviceType: "unknown", maxTouchPoints: 5 }), "User-Agent": SAFARI_IPHONE };
  check("Safari sign-in succeeds", (await login("device.admin@maslogcare.test", safari)).status === 200);
  const safariLog = await latestLog("LOGIN");
  check("Safari on iPhone logs iPhone with model unavailable", safariLog?.device?.brand === "Apple" && safariLog?.device?.deviceType === "phone" && safariLog?.device?.modelRaw === null && safariLog?.device?.modelName === null, JSON.stringify(safariLog?.device));

  check("No device headers: sign-in still works", (await login("device.admin@maslogcare.test", {})).status === 200);
  const bareLog = await latestLog("LOGIN");
  check("No device headers: server reading, low confidence", bareLog?.device?.source === "server-ua" && bareLog?.device?.confidence === "low" && bareLog?.device?.browserName === "Firefox");

  const broken = await login("device.admin@maslogcare.test", { "X-Device-Id": ANDROID_ID, "X-Device-Info": "%E0%A4%A", "X-Device-Hash": "zz" });
  check("Broken device headers never block the action", broken.status === 200, String(broken.status));
  check("Every entry so far has a device", (await SystemLog.countDocuments({ device: { $exists: false } })) === 0);

  const token = signedIn.body.token;
  const listed = await request("/system-logs?devicePlatform=android", { token, headers: native });
  check("Admin can filter by platform", listed.status === 200 && listed.body.logs.length > 0 && listed.body.logs.every((log) => log.deviceInfo?.platform === "android"), JSON.stringify(listed.body).slice(0, 300));
  check("The list carries the full device details", listed.body.logs?.[0]?.deviceInfo?.modelRaw === "SM-S918B" && "userAgent" in listed.body.logs[0].deviceInfo);
  const byBrand = await request("/system-logs?brand=apple", { token });
  check("Admin can filter by brand", byBrand.body.logs?.length > 0 && byBrand.body.logs.every((log) => log.deviceInfo?.brand === "Apple"));
  const byType = await request("/system-logs?deviceType=desktop", { token });
  check("Admin can filter by device type", byType.body.logs?.every((log) => log.deviceInfo?.deviceType === "desktop"));
  const brands = await request("/system-logs/device-brands", { token });
  check("Brand options come from the logs", brands.status === 200 && brands.body.brands.some((brand) => brand.value === "samsung"), JSON.stringify(brands.body));

  const doctor = await login("device.doctor@maslogcare.test", {});
  check("A doctor cannot read device details", (await request("/system-logs", { token: doctor.body.token })).status === 403);
  check("A doctor cannot read the brand list", (await request("/system-logs/device-brands", { token: doctor.body.token })).status === 403);

  const old = new Date(Date.now() - 400 * 86400000);
  await SystemLog.collection.insertOne({ action: "LOGIN", role: "admin", createdAt: old, userAgent: FIREFOX_WINDOWS, device: { source: "server-ua", brand: "x" } });
  const purge = await purgeExpiredDeviceDetails();
  const purged = await SystemLog.collection.findOne({ createdAt: old });
  check("Retention clears device details older than 365 days", purge.cleared === 1 && purged.userAgent === "" && purged.device.purgedAt && !purged.device.brand, JSON.stringify(purged));
  check("Retention keeps the audit entry itself", purged.action === "LOGIN");
  check("Recent entries keep their device", (await latestLog("LOGIN")).device?.source === "server-ua");

  await SystemLog.collection.insertOne({ action: "LOGIN", role: "admin", createdAt: new Date(), userAgent: SAFARI_IPHONE });
  const dry = await runMigration({ dryRun: true });
  check("Backfill dry run counts without writing", dry.entriesToBackfill === 1 && (await SystemLog.countDocuments({ device: { $exists: false } })) === 1);
  const done = await runMigration({ dryRun: false });
  const filled = await SystemLog.collection.findOne({ userAgent: SAFARI_IPHONE, "device.source": "server-ua" });
  check("Backfill gives old entries the server reading", done.entriesBackfilled === 1 && filled?.device?.brand === "Apple" && filled?.device?.confidence === "low");
  check("Backfill leaves purged entries alone", (await SystemLog.collection.findOne({ createdAt: old })).device.purgedAt);
}

(async () => {
  try {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    await run();
  } catch (error) {
    failed += 1;
    console.error("Test runner error:", error);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
  console.log(failed ? `\n${failed} failed` : "\nAll passed");
  process.exit(failed ? 1 : 0);
})();
