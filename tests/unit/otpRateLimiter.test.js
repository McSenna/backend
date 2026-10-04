"use strict";

const assert = require("assert");
const { otpSendRateLimiter, otpVerifyRateLimiter } = require("../../middleware/rateLimiter");

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

/** Runs a limiter once and returns the error it passed to next(), or null. */
const run = (limiter, { ip, email }) => {
  let result = null;
  limiter({ ip, body: { email } }, {}, (err) => {
    result = err || null;
  });
  return result;
};

test("verify requests do not use up the send budget of the same device", () => {
  const ip = "10.0.0.1";
  for (let i = 0; i < 20; i++) run(otpVerifyRateLimiter, { ip, email: `verify${i}@test.ph` });

  assert.strictEqual(run(otpSendRateLimiter, { ip, email: "fresh@test.ph" }), null);
});

test("a device can send codes to several accounts before the device limit applies", () => {
  const ip = "10.0.0.2";
  for (let i = 0; i < 14; i++) {
    assert.strictEqual(run(otpSendRateLimiter, { ip, email: `acct${i}@test.ph` }), null);
  }
});

test("the device send limit still blocks after 15 sends", () => {
  const ip = "10.0.0.3";
  for (let i = 0; i < 15; i++) run(otpSendRateLimiter, { ip, email: `bulk${i}@test.ph` });

  const err = run(otpSendRateLimiter, { ip, email: "one-more@test.ph" });
  assert.ok(err, "expected the 16th send to be limited");
  assert.strictEqual(err.statusCode, 429);
});

test("the per-email send limit blocks the 6th send to one address", () => {
  const email = "same@test.ph";
  for (let i = 0; i < 5; i++) run(otpSendRateLimiter, { ip: `10.1.0.${i}`, email });

  const err = run(otpSendRateLimiter, { ip: "10.1.0.99", email });
  assert.ok(err, "expected the 6th send to the same address to be limited");
});

test("wrong-code attempts on one address do not block sending it a new code", () => {
  const email = "typo-prone@test.ph";
  for (let i = 0; i < 5; i++) run(otpVerifyRateLimiter, { ip: "10.2.0.1", email });

  assert.strictEqual(run(otpSendRateLimiter, { ip: "10.2.0.1", email }), null);
});

console.log(`📊 SUMMARY: ${passed}/${total} TESTS PASSED`);
if (passed !== total) process.exit(1);
