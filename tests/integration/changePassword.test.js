"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
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
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function request(path, options = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${cleanPath}`);
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function setup() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}/api`;
}

async function teardown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function runTests() {
  console.log("\n--- Testing Change Password API ---\n");

  const originalPassword = "InitialPassword123!";
  const user = await User.create({
    fullname: "Maria Santos",
    email: "maria.change@maslogcare.test",
    password: originalPassword,
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

  const authHeader = {
    Authorization: `Bearer ${token}`,
    "X-Client-Platform": "mobile",
  };

  // Test 1: Reject unauthenticated request
  const unauthRes = await request("/change-password", {
    method: "POST",
    body: { currentPassword: originalPassword, newPassword: "NewSecurePassword456!" },
  });
  check("Rejects unauthenticated request with 401", unauthRes.status === 401);

  // Test 2: Reject missing current password
  const missingCurrentRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: { newPassword: "NewSecurePassword456!" },
  });
  check(
    "Rejects missing current password with 400",
    missingCurrentRes.status === 400 &&
      missingCurrentRes.body.message.includes("Current password is required")
  );

  // Test 3: Reject missing new password
  const missingNewRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: { currentPassword: originalPassword },
  });
  check(
    "Rejects missing new password with 400",
    missingNewRes.status === 400 &&
      missingNewRes.body.message.includes("New password is required")
  );

  // Test 4: Reject mismatched confirmPassword
  const mismatchRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: {
      currentPassword: originalPassword,
      newPassword: "NewSecurePassword456!",
      confirmPassword: "DifferentPassword456!",
    },
  });
  check(
    "Rejects mismatched confirm password with 400",
    mismatchRes.status === 400 &&
      mismatchRes.body.message.includes("Passwords do not match")
  );

  // Test 5: Reject new password identical to current password
  const samePasswordRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: {
      currentPassword: originalPassword,
      newPassword: originalPassword,
    },
  });
  check(
    "Rejects new password identical to current password with 400",
    samePasswordRes.status === 400 &&
      samePasswordRes.body.message.includes("different from your current password")
  );

  // Test 6: Reject weak new password
  const weakPasswordRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: {
      currentPassword: originalPassword,
      newPassword: "weak",
    },
  });
  check(
    "Rejects weak new password with 400",
    weakPasswordRes.status === 400 &&
      weakPasswordRes.body.message.includes("Password must be at least 8 characters")
  );

  // Test 7: Reject incorrect current password
  const wrongCurrentRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: {
      currentPassword: "WrongPassword999!",
      newPassword: "NewSecurePassword456!",
    },
  });
  check(
    "Rejects incorrect current password with 400",
    wrongCurrentRes.status === 400 &&
      wrongCurrentRes.body.message.includes("Current password is incorrect")
  );

  // Test 8: Successfully change password with valid payload
  const newPassword = "NewSecurePassword456!";
  const successRes = await request("/change-password", {
    method: "POST",
    headers: authHeader,
    body: {
      currentPassword: originalPassword,
      newPassword: newPassword,
      confirmPassword: newPassword,
    },
  });
  check(
    "Accepts valid change password with 200",
    successRes.status === 200 && successRes.body.success === true,
    JSON.stringify(successRes.body)
  );

  // Test 9: Verify user in DB has newly hashed password and can authenticate
  const updatedUser = await User.findById(user._id).select("+password");
  const oldMatches = await updatedUser.comparePassword(originalPassword);
  const newMatches = await updatedUser.comparePassword(newPassword);

  check("Old password no longer matches", oldMatches === false);
  check("New password correctly matches", newMatches === true);

  // Test 10: Verify login endpoint accepts new password and rejects old
  const loginWithOld = await request("/login", {
    method: "POST",
    headers: { "X-Client-Platform": "mobile" },
    body: { email: user.email, password: originalPassword },
  });
  check("Login with old password fails", loginWithOld.status !== 200);

  const loginWithNew = await request("/login", {
    method: "POST",
    headers: { "X-Client-Platform": "mobile" },
    body: { email: user.email, password: newPassword },
  });
  check("Login with new password succeeds with 200", loginWithNew.status === 200 && loginWithNew.body.success === true);

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    console.error("Failures:", failures);
    process.exit(1);
  }
}

(async () => {
  try {
    await setup();
    await runTests();
  } catch (error) {
    console.error("Test runner error:", error);
    process.exit(1);
  } finally {
    await teardown();
  }
})();
