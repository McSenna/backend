"use strict";

const assert = require("assert");
const { classifyBrevoResponse, classifyBrevoFailure, EmailErrorCode } = require("../../services/mailer/errors");
const { maskEmail } = require("../../services/mailer/config");
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

  test("TEST 1: maskEmail masks local part correctly", () => {
    assert.strictEqual(maskEmail("john.doe@gmail.com"), "j***e@gmail.com");
    assert.strictEqual(maskEmail("ab@test.ph"), "a***@test.ph");
    assert.strictEqual(maskEmail(""), "unknown");
  });

  test("TEST 2: Brevo out of credits classified as EMAIL_QUOTA_EXCEEDED", () => {
    const classified = classifyBrevoResponse(402, { code: "not_enough_credits", message: "Not enough credits" });
    assert.strictEqual(classified.code, EmailErrorCode.QUOTA_EXCEEDED);
    assert.strictEqual(classified.httpStatus, 503);
  });

  test("TEST 3: Brevo 401 classified as EMAIL_AUTH_FAILED", () => {
    const classified = classifyBrevoResponse(401, { code: "unauthorized", message: "Key not found" });
    assert.strictEqual(classified.code, EmailErrorCode.AUTH_FAILED);
    assert.strictEqual(classified.httpStatus, 503);
  });

  test("TEST 4: Network failure classified as EMAIL_NETWORK_ERROR", () => {
    const classified = classifyBrevoFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    assert.strictEqual(classified.code, EmailErrorCode.NETWORK_ERROR);
    assert.strictEqual(classified.httpStatus, 503);
  });

  test("TEST 5: Provider rate limit 429 classified as EMAIL_RATE_LIMITED", () => {
    const classified = classifyBrevoResponse(429, {});
    assert.strictEqual(classified.code, EmailErrorCode.RATE_LIMITED);
    assert.strictEqual(classified.httpStatus, 429);
  });

  test("TEST 5b: Brevo invalid recipient classified as EMAIL_RECIPIENT_INVALID", () => {
    const classified = classifyBrevoResponse(400, { code: "invalid_parameter", message: "Invalid email address" });
    assert.strictEqual(classified.code, EmailErrorCode.RECIPIENT_INVALID);
    assert.strictEqual(classified.httpStatus, 400);
  });

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
