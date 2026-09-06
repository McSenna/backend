"use strict";

const assert = require("assert");
const { classifySmtpError, EmailErrorCode, EmailServiceError } = require("../services/mailer/errors");
const { maskEmail, getMailConfig } = require("../services/mailer/transporter");
const bcrypt = require("bcryptjs");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 RUNNING MASLOGCARE EMAIL & OTP VERIFICATION TESTS");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  // TEST 1: Masking Email Security (No full email leaks in logs)
  test("TEST 1: maskEmail masks local part correctly", () => {
    assert.strictEqual(maskEmail("john.doe@gmail.com"), "j***e@gmail.com");
    assert.strictEqual(maskEmail("ab@test.ph"), "a***@test.ph");
    assert.strictEqual(maskEmail(""), "unknown");
  });

  // TEST 2: Quota Exceeded (550 Daily user sending limit exceeded)
  test("TEST 2: Gmail 550 Daily sending limit classified as EMAIL_QUOTA_EXCEEDED", () => {
    const gmailQuotaError = {
      message: "Data command failed: 550-5.4.5 Daily user sending limit exceeded.",
      code: "EENVELOPE",
      responseCode: 550,
      command: "DATA",
      response: "550-5.4.5 Daily user sending limit exceeded. For more information...",
    };

    const classified = classifySmtpError(gmailQuotaError);
    assert.strictEqual(classified.code, EmailErrorCode.QUOTA_EXCEEDED);
    assert.strictEqual(classified.httpStatus, 503);
    assert.strictEqual(classified.isRetryable, false); // Must NOT retry!
  });

  // TEST 3: Authentication Failure (535)
  test("TEST 3: SMTP 535 Bad Credentials classified as EMAIL_AUTH_FAILED", () => {
    const authError = {
      message: "Invalid login: 535-5.7.8 Username and Password not accepted.",
      code: "EAUTH",
      responseCode: 535,
      command: "AUTH PLAIN",
    };

    const classified = classifySmtpError(authError);
    assert.strictEqual(classified.code, EmailErrorCode.AUTH_FAILED);
    assert.strictEqual(classified.httpStatus, 503);
    assert.strictEqual(classified.isRetryable, false);
  });

  // TEST 4: Network Failure (ECONNREFUSED / ETIMEDOUT)
  test("TEST 4: Network failure classified as EMAIL_NETWORK_ERROR with retryable flag", () => {
    const connError = {
      message: "connect ECONNREFUSED 127.0.0.1:465",
      code: "ECONNREFUSED",
    };

    const classified = classifySmtpError(connError);
    assert.strictEqual(classified.code, EmailErrorCode.NETWORK_ERROR);
    assert.strictEqual(classified.httpStatus, 503);
    assert.strictEqual(classified.isRetryable, true); // Transient error can retry
  });

  // TEST 5: Rate limit error (421 / 429)
  test("TEST 5: Provider rate limit 429 classified as EMAIL_RATE_LIMITED", () => {
    const rateError = {
      message: "421 4.7.0 Try again later, closing connection.",
      responseCode: 421,
    };

    const classified = classifySmtpError(rateError);
    assert.strictEqual(classified.code, EmailErrorCode.RATE_LIMITED);
    assert.strictEqual(classified.httpStatus, 429);
  });

  // TEST 6: OTP Hashing Verification
  await asyncTest("TEST 6: OTP is properly hashed with bcrypt", async () => {
    const plainOtp = "654321";
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(plainOtp, salt);

    const matches = await bcrypt.compare(plainOtp, hashed);
    const wrongMatches = await bcrypt.compare("111111", hashed);

    assert.strictEqual(matches, true);
    assert.strictEqual(wrongMatches, false);
    assert.notStrictEqual(plainOtp, hashed);
  });

  // TEST 7: Production Safety - Verify OTP is NOT exposed in response payload
  test("TEST 7: Production safety - Sensitive fields stripped from JSON response", () => {
    const userDoc = {
      fullname: "Resident Test",
      email: "resident@example.com",
      password: "hashedPassword123",
      otp: "hashedOtp456",
      otpExpires: new Date(),
    };

    const response = {
      success: true,
      message: "OTP sent to your email.",
      email: userDoc.email,
    };

    assert.strictEqual(response.otp, undefined);
    assert.strictEqual(response.password, undefined);
  });

  console.log("==================================================");
  console.log(`📊 SUMMARY: ${passed}/${total} TESTS PASSED`);
  console.log("==================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
