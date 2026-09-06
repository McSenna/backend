"use strict";

const http = require("http");
const assert = require("assert");

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: 5000,
        headers: { "Content-Type": "application/json" },
        ...options,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ status: res.statusCode, headers: res.headers, data: parsed });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, raw: body });
          }
        });
      }
    );

    req.on("error", reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runApiE2E() {
  console.log("==================================================");
  console.log("🚀 RUNNING END-TO-END HTTP API TESTS FOR AUTH & OTP");
  console.log("==================================================");

  // E2E TEST 1: Missing email on /api/send-otp
  console.log("1. Testing missing email on /api/send-otp...");
  const res1 = await request({ method: "POST", path: "/api/send-otp" }, {});
  assert.strictEqual(res1.status, 400);
  assert.strictEqual(res1.data.code, "EMAIL_REQUIRED");
  console.log("✅ Passed: Returns 400 EMAIL_REQUIRED");

  // E2E TEST 2: Unregistered email on /api/send-otp
  console.log("2. Testing unregistered email on /api/send-otp...");
  const res2 = await request({ method: "POST", path: "/api/send-otp" }, { email: "unregistered_random_user@example.com" });
  assert.strictEqual(res2.status, 404);
  assert.strictEqual(res2.data.code, "REGISTRATION_NOT_FOUND");
  console.log("✅ Passed: Returns 404 REGISTRATION_NOT_FOUND");

  // E2E TEST 3: Validation failure on /api/register
  console.log("3. Testing validation failure on /api/register...");
  const res3 = await request({ method: "POST", path: "/api/register" }, { fullname: "A" });
  assert.strictEqual(res3.status, 400);
  assert.strictEqual(res3.data.code, "VALIDATION_FAILED");
  console.log("✅ Passed: Returns 400 VALIDATION_FAILED with error list");

  // E2E TEST 4: Invalid OTP format on /api/verify-otp
  console.log("4. Testing invalid OTP format on /api/verify-otp...");
  const res4 = await request({ method: "POST", path: "/api/verify-otp" }, { email: "test@example.com", otp: "12" });
  assert.strictEqual(res4.status, 400);
  assert.strictEqual(res4.data.code, "INVALID_FORMAT");
  console.log("✅ Passed: Returns 400 INVALID_FORMAT for short OTP");

  // E2E TEST 5: Verify /api/resend-otp alias functions identically
  console.log("5. Testing /api/resend-otp alias route...");
  const res5 = await request({ method: "POST", path: "/api/resend-otp" }, { email: "unregistered_random_user@example.com" });
  assert.strictEqual(res5.status, 404);
  assert.strictEqual(res5.data.code, "REGISTRATION_NOT_FOUND");
  console.log("✅ Passed: /api/resend-otp alias functions correctly");

  // E2E TEST 6: Registering a user and testing OTP cooldown & quota behavior
  console.log("6. Testing /api/register with full payload...");
  const e2eEmail = `e2e_user_${Date.now()}@example.com`;
  const registerPayload = {
    fullname: "E2E Resident Test",
    email: e2eEmail,
    password: "StrongPassword123!",
    gender: "female",
    dateOfBirth: "1998-04-12",
    address: "Purok 2, Barangay Maslog",
  };

  const res6 = await request({ method: "POST", path: "/api/register" }, registerPayload);
  console.log(`   Registration response status: ${res6.status}, code: ${res6.data.code || "SUCCESS"}`);

  // Under Gmail quota exhaustion (550), status must be 503 EMAIL_SERVICE_LIMIT (or 200 if quota reset)
  assert.ok(
    (res6.status === 503 && res6.data.code === "EMAIL_SERVICE_LIMIT") ||
    (res6.status === 200 && res6.data.success === true)
  );
  console.log("✅ Passed: /api/register handled email delivery in controlled manner without server crash");

  // E2E TEST 7: Resend OTP cooldown (Must return HTTP 429 OTP_COOLDOWN if requested within 60s)
  console.log("7. Testing /api/send-otp cooldown protection...");
  const res7 = await request({ method: "POST", path: "/api/send-otp" }, { email: e2eEmail });
  assert.strictEqual(res7.status, 429);
  assert.strictEqual(res7.data.code, "OTP_COOLDOWN");
  console.log(`✅ Passed: Cooldown active - ${res7.data.message}`);

  // E2E TEST 8: Application-level rate limiting (Burst protection)
  console.log("8. Testing application rate limiter on burst requests...");
  let rateLimited = false;
  for (let i = 0; i < 6; i++) {
    const res = await request({ method: "POST", path: "/api/send-otp" }, { email: e2eEmail });
    if (res.status === 429 && res.data.code === "OTP_RATE_LIMITED") {
      rateLimited = true;
      break;
    }
  }
  assert.strictEqual(rateLimited, true);
  console.log("✅ Passed: OTP_RATE_LIMITED activated on rapid burst requests");

  console.log("==================================================");
  console.log("🎉 ALL E2E ENDPOINTS VERIFIED SUCCESSFULLY!");
  console.log("==================================================");
}

runApiE2E().catch((err) => {
  console.error("❌ E2E Test Failed:", err);
  process.exit(1);
});
