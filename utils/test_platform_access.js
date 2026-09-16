"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const SystemLog = require("../models/SystemLog");

const BASE = process.env.TEST_BASE_URL || `http://127.0.0.1:${process.env.TEST_PORT || 5000}/api`;
const TAG = "plat-e2e";
const PASSWORD = "TestPass123!";

const ROLES = ["admin", "doctor", "midwife", "bhw", "resident"];
const emailFor = (key) => `${TAG}.${key}@maslogcare.test`;

const BROWSER_HEADERS = {
  Origin: "http://localhost:8081",
  Referer: "http://localhost:8081/",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Dest": "empty",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};

const NATIVE_HEADERS = { "User-Agent": "okhttp/4.9.2" };

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const http = require("http");
const { URL } = require("url");

function api(path, { method = "GET", body, headers = {}, token } = {}) {
  const url = new URL(`${BASE}${path}`);
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const login = (email, { platform, browser = false }) =>
  api("/login", {
    method: "POST",
    body: { email, password: PASSWORD, ...(platform ? { clientPlatform: platform } : {}) },
    headers: {
      ...(browser ? BROWSER_HEADERS : NATIVE_HEADERS),
      ...(platform ? { "X-Client-Platform": platform } : {}),
    },
  });

async function seed() {
  const specs = [];
  for (const role of ROLES) {
    specs.push({ key: role, role, status: "active", verified: true });
  }
  specs.push({ key: "resident-suspended", role: "resident", status: "suspended", verified: true });
  specs.push({ key: "resident-inactive", role: "resident", status: "inactive", verified: true });
  specs.push({ key: "resident-pending", role: "resident", status: "pending", verified: false });
  specs.push({ key: "doctor-suspended", role: "doctor", status: "suspended", verified: true });

  await cleanup();

  for (const spec of specs) {
    await User.create({
      fullname: `Platform Test ${spec.key}`,
      email: emailFor(spec.key),
      password: PASSWORD,
      gender: "female",
      dateOfBirth: new Date("1995-05-05"),
      address: "Test Address",
      verified: spec.verified,
      status: spec.status,
      role: spec.role,
    });
  }
  return specs;
}

async function cleanup() {
  const PendingRegistrationModel = require("../models/register");
  const users = await User.find({ email: { $regex: `^${TAG}\\.` } })
    .select("_id")
    .lean();
  const ids = users.map((u) => u._id);
  await SystemLog.deleteMany({
    $or: [{ userId: { $in: ids } }, { "metadata.attemptedEmail": { $regex: `^${TAG}\\.` } }],
  });
  await User.deleteMany({ email: { $regex: `^${TAG}\\.` } });
  await PendingRegistrationModel.deleteMany({ email: { $regex: `^${TAG}\\.` } });
  return ids.length;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  await seed();

  console.log("\n== 53. Platform matrix: every role x platform ==");
  const tokens = {};
  for (const role of ROLES) {
    const web = await login(emailFor(role), { platform: "web", browser: true });
    const mobile = await login(emailFor(role), { platform: "mobile" });

    if (role === "resident") {
      check(
        "RESIDENT + WEB -> 403 denied",
        web.status === 403 && web.data?.code === "RESIDENT_WEB_ACCESS_DENIED",
        `got ${web.status} ${web.data?.code}`
      );
      check("RESIDENT + WEB -> no token issued", !web.data?.token, JSON.stringify(web.data?.token));
    } else {
      check(
        `${role.toUpperCase()} + WEB -> success`,
        web.status === 200 && Boolean(web.data?.token),
        `got ${web.status} ${web.data?.code || ""}`
      );
    }
    check(
      `${role.toUpperCase()} + MOBILE -> success`,
      mobile.status === 200 && Boolean(mobile.data?.token),
      `got ${mobile.status} ${mobile.data?.code || ""}`
    );
    tokens[role] = { web: web.data?.token || null, mobile: mobile.data?.token || null };
  }

  console.log("\n== 16. Token payload carries role + platform + session ==");
  for (const role of ROLES) {
    const t = tokens[role].mobile;
    const payload = jwt.verify(t, process.env.JWT_SECRET);
    check(
      `${role} mobile token: role/platform/sessionId present`,
      payload.role === role && payload.platform === "mobile" && Boolean(payload.sessionId)
    );
  }
  const docWeb = jwt.verify(tokens.doctor.web, process.env.JWT_SECRET);
  check("doctor web token carries platform=web", docWeb.platform === "web");
  check(
    "64. staff hold independent web + mobile sessions",
    docWeb.sessionId !== jwt.verify(tokens.doctor.mobile, process.env.JWT_SECRET).sessionId
  );

  console.log("\n== 44/55. Mobile browser is still the web platform ==");
  const residentPhoneBrowser = await login(emailFor("resident"), {
    platform: "web",
    browser: true,
  });
  check(
    "resident on Android Chrome -> 403",
    residentPhoneBrowser.status === 403 &&
    residentPhoneBrowser.data?.code === "RESIDENT_WEB_ACCESS_DENIED"
  );

  console.log("\n== 4/57. A forged clientPlatform claim does not help ==");
  const forged = await login(emailFor("resident"), { platform: "mobile", browser: true });
  check(
    'browser claiming clientPlatform:"mobile" -> still denied',
    forged.status === 403 && forged.data?.code === "RESIDENT_WEB_ACCESS_DENIED",
    `got ${forged.status} ${forged.data?.code}`
  );
  check("forged browser login issues no token", !forged.data?.token);

  console.log("\n== 56. Postman / unlabelled client fails closed to web ==");
  const unlabelled = await api("/login", {
    method: "POST",
    body: { email: emailFor("resident"), password: PASSWORD },
  });
  check(
    "resident login with no platform claim -> 403",
    unlabelled.status === 403 && unlabelled.data?.code === "RESIDENT_WEB_ACCESS_DENIED",
    `got ${unlabelled.status} ${unlabelled.data?.code}`
  );
  const staffUnlabelled = await api("/login", {
    method: "POST",
    body: { email: emailFor("doctor"), password: PASSWORD },
  });
  check("doctor login with no platform claim -> allowed (web)", staffUnlabelled.status === 200);

  console.log("\n== 19/58. A copied resident mobile token cannot be replayed from a browser ==");
  const replay = await api("/appointments/me", {
    token: tokens.resident.mobile,
    headers: { ...BROWSER_HEADERS, "X-Client-Platform": "mobile" },
  });
  check(
    "resident mobile token + browser headers -> 403 PLATFORM_CONTEXT_MISMATCH",
    replay.status === 403 && replay.data?.code === "PLATFORM_CONTEXT_MISMATCH",
    `got ${replay.status} ${replay.data?.code}`
  );
  const nativeUse = await api("/appointments/me", {
    token: tokens.resident.mobile,
    headers: { ...NATIVE_HEADERS, "X-Client-Platform": "mobile" },
  });
  check(
    "same token from the mobile app -> 200",
    nativeUse.status === 200,
    `got ${nativeUse.status} ${nativeUse.data?.code}`
  );

  console.log("\n== 26. Protected APIs enforce platform on a hand-minted resident web token ==");
  const residentUser = await User.findOne({ email: emailFor("resident") }).lean();
  const forgedWebToken = jwt.sign(
    {
      userId: residentUser._id,
      email: residentUser.email,
      role: "resident",
      platform: "web",
      sessionId: "forged",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  const forgedApi = await api("/appointments/me", {
    token: forgedWebToken,
    headers: NATIVE_HEADERS,
  });
  check(
    "signed resident+web token -> 403 RESIDENT_WEB_ACCESS_DENIED",
    forgedApi.status === 403 && forgedApi.data?.code === "RESIDENT_WEB_ACCESS_DENIED",
    `got ${forgedApi.status} ${forgedApi.data?.code}`
  );

  console.log("\n== 2. Legacy tokens (no platform claim) keep staff in, keep residents out ==");
  const legacyResident = jwt.sign(
    { userId: residentUser._id, email: residentUser.email, role: "resident" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  const legacyFromBrowser = await api("/appointments/me", {
    token: legacyResident,
    headers: BROWSER_HEADERS,
  });
  check(
    "legacy resident token from a browser -> 403",
    legacyFromBrowser.status === 403,
    `got ${legacyFromBrowser.status} ${legacyFromBrowser.data?.code}`
  );
  const legacyFromApp = await api("/appointments/me", {
    token: legacyResident,
    headers: { ...NATIVE_HEADERS, "X-Client-Platform": "mobile" },
  });
  check(
    "legacy resident token from the app -> 200",
    legacyFromApp.status === 200,
    `got ${legacyFromApp.status}`
  );
  const adminUser = await User.findOne({ email: emailFor("admin") }).lean();
  const legacyAdmin = jwt.sign(
    { userId: adminUser._id, email: adminUser.email, role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  const legacyAdminWeb = await api("/users", { token: legacyAdmin, headers: BROWSER_HEADERS });
  check(
    "legacy admin token from a browser -> 200",
    legacyAdminWeb.status === 200,
    `got ${legacyAdminWeb.status}`
  );

  console.log("\n== 15/26. Role permissions are unchanged by platform authorization ==");
  const residentHitsAdminApi = await api("/users", {
    token: tokens.resident.mobile,
    headers: { ...NATIVE_HEADERS, "X-Client-Platform": "mobile" },
  });
  check(
    "resident (mobile) -> /users is still 403 by role",
    residentHitsAdminApi.status === 403,
    `got ${residentHitsAdminApi.status}`
  );
  const adminList = await api("/users", {
    token: tokens.admin.web,
    headers: BROWSER_HEADERS,
  });
  check("admin (web) -> /users 200", adminList.status === 200, `got ${adminList.status}`);
  const sample = adminList.data?.users?.find((u) => u.email === emailFor("resident"));
  check(
    "32/33. /users reports platformAccess per role",
    sample?.platformAccess?.label === "Mobile Only" &&
    sample?.platformAccess?.web === false &&
    sample?.platformAccess?.mobile === true,
    JSON.stringify(sample?.platformAccess)
  );
  const staffSample = adminList.data?.users?.find((u) => u.email === emailFor("doctor"));
  check(
    "34. staff report Web + Mobile",
    staffSample?.platformAccess?.label === "Web + Mobile"
  );

  console.log("\n== 59/60. Account status is enforced independently of platform ==");
  for (const [key, label] of [
    ["resident-suspended", "suspended resident"],
    ["resident-inactive", "inactive resident"],
    ["resident-pending", "pending resident"],
  ]) {
    const r = await login(emailFor(key), { platform: "mobile" });
    check(`${label} + MOBILE -> denied`, r.status === 403 && !r.data?.token, `got ${r.status}`);
  }
  const suspendedDoctorWeb = await login(emailFor("doctor-suspended"), {
    platform: "web",
    browser: true,
  });
  const suspendedDoctorMobile = await login(emailFor("doctor-suspended"), { platform: "mobile" });
  check(
    "suspended doctor + WEB -> denied",
    suspendedDoctorWeb.status === 403 && !suspendedDoctorWeb.data?.token
  );
  check(
    "suspended doctor + MOBILE -> denied",
    suspendedDoctorMobile.status === 403 && !suspendedDoctorMobile.data?.token
  );

  console.log("\n== 28. Login errors do not leak account existence ==");
  const unknown = await api("/login", {
    method: "POST",
    body: { email: "nobody.here@maslogcare.test", password: PASSWORD, clientPlatform: "web" },
  });
  const wrongPassword = await api("/login", {
    method: "POST",
    body: { email: emailFor("doctor"), password: "WrongPassword1!", clientPlatform: "web" },
  });
  check(
    "unknown email and wrong password are indistinguishable",
    unknown.status === wrongPassword.status &&
    unknown.data?.code === wrongPassword.data?.code &&
    unknown.data?.message === wrongPassword.data?.message,
    `${unknown.status}/${unknown.data?.code} vs ${wrongPassword.status}/${wrongPassword.data?.code}`
  );
  const residentWrongPassword = await api("/login", {
    method: "POST",
    body: { email: emailFor("resident"), password: "WrongPassword1!", clientPlatform: "web" },
  });
  check(
    "resident + web + wrong password -> generic credential error, not the platform error",
    residentWrongPassword.data?.code === "INVALID_CREDENTIALS",
    `got ${residentWrongPassword.data?.code}`
  );

  console.log("\n== 37/38/68. Blocked attempts are audit-logged safely ==");
  await new Promise((r) => setTimeout(r, 400));
  const blockedLogs = await SystemLog.find({ action: "RESIDENT_WEB_LOGIN_BLOCKED" })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  check("RESIDENT_WEB_LOGIN_BLOCKED entries were written", blockedLogs.length > 0);
  if (blockedLogs.length) {
    const log = blockedLogs[0];
    check("blocked entry records role + client platform + failure",
      log.role === "resident" && log.clientPlatform === "web" && log.success === false);
    check("blocked entry severity is error/warning", ["error", "warning"].includes(log.severity));
    const serialized = JSON.stringify(log);
    check(
      "no password, token or OTP anywhere in the entry",
      !/TestPass123|eyJhbGciOi/.test(serialized)
    );
  }
  const successLogs = await SystemLog.find({ action: "LOGIN", clientPlatform: "mobile" })
    .sort({ createdAt: -1 })
    .limit(1)
    .lean();
  check("successful logins record their platform", successLogs.length > 0);

  console.log("\n== 7/9. Registration issues a session only where the role may hold one ==");
  const mailerPath = require.resolve("../services/mailer");
  require.cache[mailerPath] = {
    id: mailerPath,
    filename: mailerPath,
    loaded: true,
    exports: {
      sendOTPEmail: async () => { },
      sendWelcomeEmail: async () => { },
      verifyTransport: () => { },
    },
  };
  const authController = require("../controllers/authController");
  const PendingRegistration = require("../models/register");

  const verifyOnPlatform = async (platform) => {
    const email = emailFor(`signup-${platform}`);
    await User.deleteMany({ email });
    await PendingRegistration.deleteMany({ email });
    await PendingRegistration.create({
      fullname: `Signup ${platform}`,
      email,
      password: PASSWORD,
      gender: "female",
      dateOfBirth: new Date("1997-07-07"),
      address: "Test Address",
      role: "resident",
      otp: "123456",
      otpExpires: new Date(Date.now() + 5 * 60 * 1000),
      lastOtpSentAt: new Date(),
      verificationAttempts: 0,
    });

    const req = {
      body: { email, otp: "123456", clientPlatform: platform },
      headers: {},
      clientPlatform: { platform, isBrowserRequest: platform === "web", source: "test" },
      socket: {},
    };
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    let handlerError = null;
    await authController.verifyOtp(req, res, (err) => {
      handlerError = err;
    });
    if (handlerError) throw handlerError;
    return res;
  };

  const webSignup = await verifyOnPlatform("web");
  check(
    "resident verifies OTP on web -> account created, no session",
    webSignup.statusCode === 201 &&
    webSignup.body?.success === true &&
    webSignup.body?.token === null &&
    webSignup.body?.code === "RESIDENT_WEB_ACCESS_DENIED",
    `got ${webSignup.statusCode} token=${webSignup.body?.token} code=${webSignup.body?.code}`
  );
  check(
    "the web signup's account really exists",
    Boolean(await User.findOne({ email: emailFor("signup-web") }).lean())
  );

  const mobileSignup = await verifyOnPlatform("mobile");
  check(
    "resident verifies OTP on mobile -> session issued",
    mobileSignup.statusCode === 201 && Boolean(mobileSignup.body?.token),
    `got ${mobileSignup.statusCode}`
  );
  check(
    "that session is bound to the mobile platform",
    jwt.verify(mobileSignup.body.token, process.env.JWT_SECRET).platform === "mobile"
  );
  await PendingRegistration.deleteMany({ email: { $regex: `^${TAG}\\.` } });

  console.log("\n== 63. Logout still works on both platforms ==");
  const logoutWeb = await api("/logout", {
    method: "POST",
    token: tokens.doctor.web,
    headers: BROWSER_HEADERS,
  });
  const logoutMobile = await api("/logout", {
    method: "POST",
    token: tokens.resident.mobile,
    headers: { ...NATIVE_HEADERS, "X-Client-Platform": "mobile" },
  });
  check("doctor web logout -> 200", logoutWeb.status === 200, `got ${logoutWeb.status}`);
  check("resident mobile logout -> 200", logoutMobile.status === 200, `got ${logoutMobile.status}`);

  const removed = await cleanup();
  console.log(`\nCleaned up ${removed} test accounts and their log entries.`);

  await mongoose.disconnect();

  console.log(`\n================ ${passed} passed, ${failed} failed ================`);
  if (failed) {
    console.log("Failures:");
    failures.forEach((f) => console.log(` - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

run().catch(async (error) => {
  console.error("Harness error:", error);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch { }
  process.exit(1);
});
