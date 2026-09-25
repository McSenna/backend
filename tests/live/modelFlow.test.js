"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const PendingRegistration = require("../../models/register");
const User = require("../../models/User");

async function runModelAndFlowTests() {
  console.log("==================================================");
  console.log("🔬 TESTING REGISTRATION MODEL, HASHING & COOLDOWN");
  console.log("==================================================");

  await connectDB();

  const testEmail = `test_flow_${Date.now()}@example.com`;

  try {
    await PendingRegistration.deleteMany({ email: testEmail });
    await User.deleteMany({ email: testEmail });

    const plainOtp = "842915";
    const pending = await PendingRegistration.create({
      fullname: "Flow Test Resident",
      email: testEmail,
      password: "TestPassword123!",
      gender: "female",
      dateOfBirth: new Date("1995-05-15"),
      address: "123 Maslog Street",
      role: "resident",
      otp: plainOtp,
      otpExpires: new Date(Date.now() + 5 * 60 * 1000),
      lastOtpSentAt: new Date(),
      verificationAttempts: 0,
    });

    const fetched = await PendingRegistration.findById(pending._id).select("+otp +otpExpires +password");
    console.log("3. Checking if stored OTP is hashed...");
    if (fetched.otp === plainOtp) {
      throw new Error("FAIL: Stored OTP is plain text!");
    }
    if (!fetched.otp.startsWith("$2")) {
      throw new Error("FAIL: Stored OTP is not a bcrypt hash!");
    }
    console.log("✅ Passed: Stored OTP is securely bcrypt-hashed");

    const correctMatch = await fetched.verifyOtp(plainOtp);
    const wrongMatch = await fetched.verifyOtp("000000");
    if (!correctMatch || wrongMatch) {
      throw new Error("FAIL: verifyOtp method returned incorrect boolean!");
    }
    console.log("✅ Passed: pending.verifyOtp() validates correctly against bcrypt hash");

    fetched.verificationAttempts = (fetched.verificationAttempts || 0) + 1;
    await fetched.save();
    const updated = await PendingRegistration.findById(pending._id).select("+verificationAttempts");
    if (updated.verificationAttempts !== 1) {
      throw new Error("FAIL: verificationAttempts did not increment");
    }
    console.log("✅ Passed: verificationAttempts incremented to 1 without destroying record");

    await PendingRegistration.deleteMany({ email: testEmail });
    console.log("✅ Passed: Cleanup successful");

    console.log("==================================================");
    console.log("🎉 ALL MODEL & FLOW TESTS COMPLETED SUCCESSFULLY!");
    console.log("==================================================");
  } finally {
    await mongoose.disconnect();
  }
}

runModelAndFlowTests().catch((err) => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
