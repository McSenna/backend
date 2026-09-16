"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const PasswordReset = require("../models/PasswordReset");
const mailerPath = require.resolve("../services/mailer");

const sent = [];
const realMailer = require(mailerPath);
require.cache[mailerPath].exports = {
  ...realMailer,
  sendPasswordResetCodeEmail: async (email, otp, fullname) => {
    sent.push({ email, otp, fullname });
  },
  sendPasswordChangedEmail: async (payload) => {
    if (notifyShouldFail) throw new Error("simulated SMTP outage");
    notices.push(payload);
  },
};

const notices = [];
let notifyShouldFail = false;

const ctrl = require("../controllers/passwordResetController");

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? `  -> ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

function run(handler, body) {
  return new Promise((resolve) => {
    const req = { body, headers: {}, socket: {}, user: null };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ ok: true, status: this.statusCode, body: payload }); },
    };
    Promise.resolve(handler(req, res, (err) => resolve({ ok: false, error: err })))
      .catch((err) => resolve({ ok: false, error: err }));
  });
}

const TAG = `reset-test-${Date.now()}`;
const EMAIL = `${TAG}@example.com`;
const OLD_PASSWORD = "OldPassw0rd!";
const NEW_PASSWORD = "BrandNewPass1!";

async function plantKnownCode(code, { expired = false, verified = false } = {}) {
  await PasswordReset.deleteMany({ email: EMAIL });
  const user = await User.findOne({ email: EMAIL }).select("_id").lean();
  const doc = new PasswordReset({
    email: EMAIL,
    user: user._id,
    otp: code,
    otpExpires: new Date(Date.now() + (expired ? -60_000 : 10 * 60_000)),
    lastSentAt: new Date(Date.now() - 120_000),
    verifiedAt: verified ? new Date() : null,
  });
  await doc.save();
  return doc;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  await User.create({
    fullname: "Reset Test User",
    email: EMAIL,
    password: OLD_PASSWORD,
    gender: "other",
    dateOfBirth: new Date("1990-01-01"),
    address: "Test address",
    role: "resident",
    verified: true,
  });

  try {
    section("Requesting a code says nothing about whether the account exists");
    {
      const known = await run(ctrl.forgotPassword, { email: EMAIL });
      const unknown = await run(ctrl.forgotPassword, { email: `nobody-${TAG}@example.com` });
      check("a registered address gets the neutral message", known.ok);
      check("an unregistered address gets the same message",
        unknown.ok && unknown.body.message === known.body.message,
        `${unknown.body?.message} vs ${known.body?.message}`);
      check("and the same status code", known.status === unknown.status);
      check("a code was stored for the real account", await PasswordReset.exists({ email: EMAIL }));
      check("and nothing for the unknown one",
        !(await PasswordReset.exists({ email: `nobody-${TAG}@example.com` })));

      const invalid = await run(ctrl.forgotPassword, { email: "not-an-email" });
      check("a malformed address is rejected outright", !invalid.ok);

      check("an email was actually dispatched for the real account",
        sent.length === 1 && sent[0].email === EMAIL, JSON.stringify(sent.map((s) => s.email)));
      check("and none for the unregistered one", sent.every((s) => s.email === EMAIL));
      check("the dispatched code is six digits", /^\d{6}$/.test(sent[0]?.otp || ""), sent[0]?.otp);
    }

    section("The stored code is hashed, never plain");
    {
      await plantKnownCode("123456");
      const row = await PasswordReset.findOne({ email: EMAIL }).select("+otp").lean();
      check("not stored in plain text", row.otp !== "123456");
      check("stored as a bcrypt hash", /^\$2[aby]\$/.test(row.otp));
      check("and still verifies", await bcrypt.compare("123456", row.otp));
    }

    section("Verification");
    {
      await plantKnownCode("246810");
      const wrong = await run(ctrl.verifyResetCode, { email: EMAIL, code: "111111" });
      check("a wrong code is refused", !wrong.ok);
      check("and does not say which part was wrong",
        /incorrect or has expired/i.test(wrong.error?.message || ""), wrong.error?.message);

      const row = await PasswordReset.findOne({ email: EMAIL }).lean();
      check("the failed attempt was counted", row.attempts === 1);

      const right = await run(ctrl.verifyResetCode, { email: EMAIL, code: "246810" });
      check("the correct code is accepted", right.ok);
      const after = await PasswordReset.findOne({ email: EMAIL }).lean();
      check("and the request is marked verified", Boolean(after.verifiedAt));
    }

    section("An expired code is dead");
    {
      await plantKnownCode("314159", { expired: true });
      const result = await run(ctrl.verifyResetCode, { email: EMAIL, code: "314159" });
      check("expired codes are refused", !result.ok);
    }

    section("Repeated wrong guesses destroy the request");
    {
      await plantKnownCode("555555");
      let last;
      for (let i = 0; i < 5; i++) {
        last = await run(ctrl.verifyResetCode, { email: EMAIL, code: "000000" });
      }
      check("the fifth attempt reports a lockout",
        !last.ok && /Too many incorrect attempts/i.test(last.error?.message || ""), last.error?.message);
      check("and the request no longer exists", !(await PasswordReset.exists({ email: EMAIL })));
    }

    section("Resetting the password");
    {
      await plantKnownCode("777777", { verified: false });
      const unverified = await run(ctrl.resetPassword, {
        email: EMAIL, code: "777777", newPassword: NEW_PASSWORD,
      });
      check("a code that was never verified cannot reset", !unverified.ok);

      await plantKnownCode("777777", { verified: true });
      const weak = await run(ctrl.resetPassword, {
        email: EMAIL, code: "777777", newPassword: "weak",
      });
      check("a weak password is refused", !weak.ok);
      check("and the message names the rules",
        /at least 8 characters/i.test(weak.error?.message || ""), weak.error?.message);

      const wrongCode = await run(ctrl.resetPassword, {
        email: EMAIL, code: "888888", newPassword: NEW_PASSWORD,
      });
      check("a verified request still needs the right code", !wrongCode.ok);

      const done = await run(ctrl.resetPassword, {
        email: EMAIL, code: "777777", newPassword: NEW_PASSWORD,
      });
      check("a verified request with the right code succeeds", done.ok, done.error?.message);
    }

    section("The confirmation email fires only after a real change");
    {
      check("exactly one notice was sent", notices.length === 1, String(notices.length));
      check("addressed to the account", notices[0]?.email === EMAIL);
      check("carries a server-generated timestamp", notices[0]?.changedAt instanceof Date);
      check("carries the name, not credentials",
        notices[0]?.fullname === "Reset Test User" &&
        !("password" in (notices[0] || {})) &&
        !("otp" in (notices[0] || {})) &&
        !("code" in (notices[0] || {})),
        JSON.stringify(Object.keys(notices[0] || {})));

      const before = notices.length;
      await run(ctrl.verifyResetCode, { email: EMAIL, code: "000000" });
      await run(ctrl.resetPassword, { email: EMAIL, code: "000000", newPassword: NEW_PASSWORD });
      await run(ctrl.resetPassword, { email: EMAIL, code: "000000", newPassword: "weak" });
      check("no notice for failed verification or rejected resets",
        notices.length === before, `${notices.length} vs ${before}`);
    }

    section("A failed notification does not undo the password change");
    {
      const OTHER = "SecondPass1!";
      notifyShouldFail = true;
      await plantKnownCode("424242", { verified: true });
      const result = await run(ctrl.resetPassword, {
        email: EMAIL, code: "424242", newPassword: OTHER,
      });
      notifyShouldFail = false;

      check("the reset still reports success", result.ok, result.error?.message);
      check("and reports the notification as not sent",
        result.body?.notification?.sent === false, JSON.stringify(result.body?.notification));

      const user = await User.findOne({ email: EMAIL }).select("+password");
      check("the new password really was saved", await user.comparePassword(OTHER));

      await plantKnownCode("515151", { verified: true });
      await run(ctrl.resetPassword, { email: EMAIL, code: "515151", newPassword: NEW_PASSWORD });
    }

    section("The response carries a masked address, never the full one");
    {
      await plantKnownCode("616161", { verified: true });
      const result = await run(ctrl.resetPassword, {
        email: EMAIL, code: "616161", newPassword: NEW_PASSWORD,
      });
      const masked = result.body?.notification?.maskedEmail || "";
      check("an address is returned masked", masked.includes("***"), masked);
      check("and is not the full address", masked !== EMAIL, masked);
      check("a timestamp is returned", Boolean(result.body?.changedAt));
    }

    section("The new password works and the old one does not");
    {
      const user = await User.findOne({ email: EMAIL }).select("+password");
      check("the new password authenticates", await user.comparePassword(NEW_PASSWORD));
      check("the old password no longer does", !(await user.comparePassword(OLD_PASSWORD)));
      check("it is stored hashed, not in plain text", user.password !== NEW_PASSWORD);
    }

    section("A used code cannot be replayed");
    {
      check("the request was destroyed on success", !(await PasswordReset.exists({ email: EMAIL })));
      const replay = await run(ctrl.resetPassword, {
        email: EMAIL, code: "777777", newPassword: "AnotherPass1!",
      });
      check("replaying it is refused", !replay.ok);
      const user = await User.findOne({ email: EMAIL }).select("+password");
      check("and the password is unchanged", await user.comparePassword(NEW_PASSWORD));
    }

    section("Resend cooldown");
    {
      await PasswordReset.deleteMany({ email: EMAIL });
      await run(ctrl.forgotPassword, { email: EMAIL });
      const immediate = await run(ctrl.forgotPassword, { email: EMAIL });
      check("a second request inside the window is refused",
        !immediate.ok && immediate.error?.statusCode === 429, String(immediate.error?.statusCode));
    }
  } finally {
    await User.deleteMany({ email: EMAIL });
    await PasswordReset.deleteMany({ email: EMAIL });
    console.log("\n(test data removed)");
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("Harness error:", e); process.exit(1); });
