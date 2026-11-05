"use strict";

// When Brevo refuses an OTP email, the user must be able to retry right away:
// a send that never left the server must not start the resend cooldown, and a
// permanent recipient rejection must not be retried. Brevo is
// stubbed, so no real email is sent. Every address here is invented.

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_PROVIDER = "brevo";
process.env.BREVO_API_KEY = "test-brevo-key";
process.env.BREVO_SENDER_EMAIL = "sender@maslogcare.test";

const http = require("http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const logger = require("../../utils/logger");
const { createApp } = require("../../app");
const User = require("../../models/User");
const EmailVerification = require("../../models/EmailVerification");
const PasswordReset = require("../../models/PasswordReset");
const PendingRegistration = require("../../models/register");
const { sendEmailVerification } = require("../../services/auth/emailVerificationService");

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
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let brevoCalls = 0;
let brevoMode = "reject";
global.fetch = async () => {
  brevoCalls += 1;
  if (brevoMode === "reject") {
    return new Response(JSON.stringify({ code: "invalid_parameter", message: "email is not valid in to" }), { status: 400 });
  }
  return new Response(JSON.stringify({ messageId: `stub-${brevoCalls}` }), { status: 201 });
};

const loggedErrors = [];
const originalLoggerError = logger.error;
logger.error = (message, context) => {
  loggedErrors.push({ message, context });
};

function post(path, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(`${baseUrl}${path}`),
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function testRegistrationCode() {
  console.log("\n--- Registration code: rejected recipient ---");
  const email = "no-such-mailbox@maslogcare.test";

  brevoMode = "reject";
  brevoCalls = 0;
  let caught = null;
  try {
    await sendEmailVerification(email);
  } catch (error) {
    caught = error;
  }

  check("rejected recipient surfaces as EMAIL_RECIPIENT_INVALID", caught?.code === "EMAIL_RECIPIENT_INVALID", caught?.code);
  check("a permanent rejection is attempted once, not retried", brevoCalls === 1, `calls=${brevoCalls}`);

  const record = await EmailVerification.findOne({ email }).select("+lastOtpSentAt");
  check("a failed send does not start the resend cooldown", !record?.lastOtpSentAt);

  brevoMode = "accept";
  let retryError = null;
  try {
    await sendEmailVerification(email);
  } catch (error) {
    retryError = error;
  }
  check("the user can request a new code immediately", retryError === null, retryError?.code);

  let cooldownError = null;
  try {
    await sendEmailVerification(email);
  } catch (error) {
    cooldownError = error;
  }
  check("a delivered code still starts the cooldown", cooldownError?.code === "OTP_COOLDOWN", cooldownError?.code);
}

async function testPasswordResetCode() {
  console.log("\n--- Password reset code: rejected recipient ---");
  const email = "reset-bounce@maslogcare.test";
  await User.create({
    fullname: "Test Resident",
    email,
    password: "TestPass123",
    role: "resident",
    verified: true,
    status: "approved",
    phone: "09171234567",
    gender: "female",
    dateOfBirth: new Date("1995-05-15"),
    address: "Purok 1, Maslog",
  });

  brevoMode = "reject";
  loggedErrors.length = 0;
  const first = await post("/forgot-password", { email });
  check("forgot-password keeps the neutral response on failure", first.status === 200, `status=${first.status}`);

  const logged = loggedErrors.find((entry) => entry.message === "Password reset request failed");
  check("the real failure code is logged", logged?.context?.errorCode === "EMAIL_RECIPIENT_INVALID", JSON.stringify(logged?.context));
  check("the log does not contain the address", !JSON.stringify(logged ?? {}).includes(email));

  const record = await PasswordReset.findOne({ email });
  check("a failed reset send leaves no code behind to block a retry", record === null);

  brevoMode = "accept";
  brevoCalls = 0;
  const retry = await post("/forgot-password", { email });
  check("the user can request a reset code again immediately", retry.status === 200 && brevoCalls === 1, `status=${retry.status} calls=${brevoCalls}`);
}

async function testPendingRegistrationResend() {
  console.log("\n--- Pending registration resend: rejected recipient ---");
  const email = "pending-bounce@maslogcare.test";
  // Inserted raw so the test can backdate lastOtpSentAt past the cooldown.
  await PendingRegistration.collection.insertOne({
    email,
    fullname: "Test Resident",
    gender: "female",
    dateOfBirth: new Date("1995-05-15"),
    address: "Purok 1, Maslog",
    lastOtpSentAt: new Date(Date.now() - 10 * 60 * 1000),
    otpExpires: new Date(Date.now() + 60 * 60 * 1000),
  });

  brevoMode = "reject";
  const first = await post("/send-otp", { email });
  check("rejected recipient returns 400 EMAIL_RECIPIENT_INVALID", first.status === 400 && first.body?.code === "EMAIL_RECIPIENT_INVALID", `status=${first.status} code=${first.body?.code}`);

  brevoMode = "accept";
  brevoCalls = 0;
  const retry = await post("/send-otp", { email });
  check("the user can request a new code immediately", retry.status === 200 && brevoCalls === 1, `status=${retry.status} code=${retry.body?.code}`);
}

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    await testRegistrationCode();
    await testPasswordResetCode();
    await testPendingRegistrationResend();
  } finally {
    logger.error = originalLoggerError;
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
