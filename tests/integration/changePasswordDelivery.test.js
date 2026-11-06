"use strict";

// The answer to a password change must reflect the database write, not the
// notice email. A stalled mail server once held the response past the app's
// 15 second timeout after the password had already changed, so the app said
// "Password not changed". Brevo is stubbed, so no real email is
// sent. Every address here is invented.

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_PROVIDER = "brevo";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.BREVO_SENDER_EMAIL = "sender@maslogcare.test";

const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const logger = require("../../utils/logger");
const { createApp } = require("../../app");
const User = require("../../models/User");

let mongod;
let server;
let baseUrl;
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// A provider that accepts the connection and never answers.
let brevoMode = "stall";
let brevoCalls = 0;
global.fetch = async () => {
  brevoCalls += 1;
  if (brevoMode === "stall") return new Promise(() => {});
  if (brevoMode === "reject") {
    return new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), { status: 401 });
  }
  return new Response(JSON.stringify({ messageId: `stub-${brevoCalls}` }), { status: 201 });
};

const logged = [];
for (const level of ["warn", "error"]) {
  logger[level] = (message, context) => logged.push({ level, message, context });
}

const RESPONSE_BUDGET_MS = 3000;

async function request(path, options = {}) {
  const url = new URL(`${baseUrl}${path}`);
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const body = options.body ? JSON.stringify(options.body) : null;
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || "GET", headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = data;
        try {
          parsed = data ? JSON.parse(data) : {};
        } catch {
          // Kept as text so the check can print it.
        }
        resolve({ status: res.statusCode, body: parsed, elapsedMs: Date.now() - startedAt });
      });
    });
    req.setTimeout(RESPONSE_BUDGET_MS, () => req.destroy(new Error(`No response within ${RESPONSE_BUDGET_MS}ms`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

let accountCount = 0;
async function createAccount(password) {
  accountCount += 1;
  const user = await User.create({
    fullname: `Test Resident ${accountCount}`,
    email: `change.delivery${accountCount}@maslogcare.test`,
    password,
    role: "resident",
    verified: true,
    status: "approved",
    phone: "09171234567",
    gender: "female",
    dateOfBirth: new Date("1995-05-15"),
    address: "Purok 1, Maslog",
    approved_at: new Date(),
  });
  const token = jwt.sign(
    { userId: String(user._id), role: user.role, platform: "mobile" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { user, headers: { Authorization: `Bearer ${token}`, "X-Client-Platform": "mobile" } };
}

const changePassword = (headers, body) => request("/change-password", { method: "POST", headers, body });

const login = async (email, password) =>
  request("/login", { method: "POST", headers: { "X-Client-Platform": "mobile" }, body: { email, password } });

async function passwordState(userId, oldPassword, newPassword) {
  const stored = await User.findById(userId).select("+password");
  return {
    oldWorks: await stored.comparePassword(oldPassword),
    newWorks: await stored.comparePassword(newPassword),
  };
}

const OLD = "InitialPass123!";
const NEW = "NewSecure456!";
const change = { currentPassword: OLD, newPassword: NEW, confirmPassword: NEW };

async function stalledNoticeDoesNotDelayTheAnswer() {
  brevoMode = "stall";
  const { user, headers } = await createAccount(OLD);
  const res = await settle(changePassword(headers, change));

  check(
    "Answers 200 while the notice email is still stalled",
    res.value?.status === 200 && res.value.body.success === true,
    res.error ? res.error.message : JSON.stringify(res.value?.body)
  );
  check("Answers well inside the app's timeout", res.value?.elapsedMs < RESPONSE_BUDGET_MS, `${res.value?.elapsedMs}ms`);

  const state = await passwordState(user._id, OLD, NEW);
  check("The new password is stored after a stalled notice", state.newWorks && !state.oldWorks);

  const withOld = await login(user.email, OLD);
  const withNew = await login(user.email, NEW);
  check("Sign-in with the old password is refused", withOld.status === 401, String(withOld.status));
  check("Sign-in with the new password works", withNew.status === 200 && withNew.body.success === true);

  // Every token from before the change is revoked; the answer carries this session's replacement.
  const stale = await request("/profile", { headers });
  check("The token from before the change is refused", stale.status === 401, String(stale.status));
  const rotated = { ...headers, Authorization: `Bearer ${res.value?.body.token}` };
  const profile = await request("/profile", { headers: rotated });
  check("The session that changed the password stays signed in on the returned token", profile.status === 200, String(profile.status));
}

async function failedNoticeIsLoggedNotReported() {
  brevoMode = "reject";
  logged.length = 0;
  const { user, headers } = await createAccount(OLD);
  const res = await changePassword(headers, change);
  await new Promise((resolve) => setImmediate(resolve));

  check("A refused notice email still answers 200", res.status === 200 && res.body.success === true, JSON.stringify(res.body));
  check("The new password is stored after a refused notice", (await passwordState(user._id, OLD, NEW)).newWorks);

  const notice = logged.find((entry) => /password-changed notice/i.test(entry.message));
  check("The refused notice is logged", Boolean(notice), JSON.stringify(logged.map((entry) => entry.message)));
  const serialized = JSON.stringify(logged);
  check(
    "The log holds no password or full address",
    !serialized.includes(OLD) && !serialized.includes(NEW) && !serialized.includes(user.email)
  );
}

async function failureBeforeTheWriteLeavesThePassword() {
  brevoMode = "accept";
  const { user, headers } = await createAccount(OLD);
  const originalSave = User.prototype.save;
  User.prototype.save = async function failingSave() {
    throw new Error("Simulated database outage");
  };
  let res;
  try {
    res = await changePassword(headers, change);
  } finally {
    User.prototype.save = originalSave;
  }

  check("A failed write answers 500", res.status === 500, String(res.status));
  check("A failed write keeps success off the answer", res.body.success !== true);
  const state = await passwordState(user._id, OLD, NEW);
  check("A failed write leaves the old password in place", state.oldWorks && !state.newWorks);
}

async function wrongCurrentPasswordChangesNothing() {
  brevoMode = "accept";
  const { user, headers } = await createAccount(OLD);
  const res = await changePassword(headers, { ...change, currentPassword: "WrongPass999!" });

  check(
    "A wrong current password answers 400 INVALID_CREDENTIALS, not 401",
    res.status === 400 && res.body.code === "INVALID_CREDENTIALS",
    `${res.status} ${res.body.code}`
  );
  const state = await passwordState(user._id, OLD, NEW);
  check("A wrong current password leaves the old password in place", state.oldWorks && !state.newWorks);
}

async function repeatedSubmissionsEndConsistent() {
  brevoMode = "accept";
  const { user, headers } = await createAccount(OLD);
  const [first, second] = await Promise.all([changePassword(headers, change), changePassword(headers, change)]);
  const answered = [first, second].find((res) => res.status === 200);
  const retry = await changePassword({ ...headers, Authorization: `Bearer ${answered?.body.token}` }, change);

  check(
    "Two identical submissions each answer 200 or a refused current password",
    [first, second].every((res) => res.status === 200 || res.body.code === "INVALID_CREDENTIALS"),
    `${first.status} ${second.status}`
  );
  check("At least one of them reports the change", [first, second].some((res) => res.status === 200));
  check(
    "A resubmission after the change refuses the old current password",
    retry.status === 400 && retry.body.code === "INVALID_CREDENTIALS",
    `${retry.status} ${retry.body.code}`
  );
  const state = await passwordState(user._id, OLD, NEW);
  check("The account ends with the new password", state.newWorks && !state.oldWorks);
}

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  console.log("\n--- Change password: answer follows the database write ---\n");
  await stalledNoticeDoesNotDelayTheAnswer();
  await failedNoticeIsLoggedNotReported();
  await failureBeforeTheWriteLeavesThePassword();
  await wrongCurrentPasswordChangesNothing();
  await repeatedSubmissionsEndConsistent();

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) console.error("Failures:", failures);
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error("Test runner error:", error);
    failed += 1;
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(failed > 0 ? 1 : 0);
  }
})();
