"use strict";

// When Gmail rejects an OTP email, the user must be able to retry right away:
// a send that never left the server must not start the resend cooldown, and a
// permanent recipient rejection must not be retried. The SMTP transport is
// stubbed, so no real email is sent. Every address here is invented.

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_PROVIDER = "smtp";
process.env.EMAIL_USER = "sender@maslogcare.test";
process.env.EMAIL_PASSWORD = "test-app-password";

const http = require("http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { transporter } = require("../../services/mailer/transporter");
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

const UNKNOWN_MAILBOX = Object.assign(
  new Error("Can't send mail - all recipients were rejected: 550-5.1.1 The email account that you tried to reach does not exist."),
  { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" }
);

let smtpCalls = 0;
let smtpMode = "reject";
transporter.sendMail = async () => {
  smtpCalls += 1;
  if (smtpMode === "reject") throw UNKNOWN_MAILBOX;
  return { messageId: `stub-${smtpCalls}`, response: "250 OK" };
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

  smtpMode = "reject";
  smtpCalls = 0;
  let caught = null;
  try {
    await sendEmailVerification(email);
  } catch (error) {
    caught = error;
  }

  check("rejected recipient surfaces as EMAIL_RECIPIENT_INVALID", caught?.code === "EMAIL_RECIPIENT_INVALID", caught?.code);
  check("a permanent rejection is attempted once, not retried", smtpCalls === 1, `calls=${smtpCalls}`);

  const record = await EmailVerification.findOne({ email }).select("+lastOtpSentAt");
  check("a failed send does not start the resend cooldown", !record?.lastOtpSentAt);

  smtpMode = "accept";
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

  smtpMode = "reject";
  loggedErrors.length = 0;
  const first = await post("/forgot-password", { email });
  check("forgot-password keeps the neutral response on failure", first.status === 200, `status=${first.status}`);

  const logged = loggedErrors.find((entry) => entry.message === "Password reset request failed");
  check("the real failure code is logged", logged?.context?.errorCode === "EMAIL_RECIPIENT_INVALID", JSON.stringify(logged?.context));
  check("the log does not contain the address", !JSON.stringify(logged ?? {}).includes(email));

  const record = await PasswordReset.findOne({ email });
  check("a failed reset send leaves no code behind to block a retry", record === null);

  smtpMode = "accept";
  smtpCalls = 0;
  const retry = await post("/forgot-password", { email });
  check("the user can request a reset code again immediately", retry.status === 200 && smtpCalls === 1, `status=${retry.status} calls=${smtpCalls}`);
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

  smtpMode = "reject";
  const first = await post("/send-otp", { email });
  check("rejected recipient returns 400 EMAIL_RECIPIENT_INVALID", first.status === 400 && first.body?.code === "EMAIL_RECIPIENT_INVALID", `status=${first.status} code=${first.body?.code}`);

  smtpMode = "accept";
  smtpCalls = 0;
  const retry = await post("/send-otp", { email });
  check("the user can request a new code immediately", retry.status === 200 && smtpCalls === 1, `status=${retry.status} code=${retry.body?.code}`);
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
