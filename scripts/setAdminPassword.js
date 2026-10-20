#!/usr/bin/env node
"use strict";

require("dotenv").config();
const connectDB = require("../config/db");
const User = require("../models/User");

const usage = () => {
  console.log("Usage: node backend/scripts/setAdminPassword.js --email admin@example.com --password NewPass123");
};

const parseArgs = () => {
  const argv = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
      opts[key] = val;
    }
  }
  return opts;
};

const main = async () => {
  const opts = parseArgs();
  const email = (opts.email || process.env.TARGET_EMAIL || "").trim().toLowerCase();
  const password = opts.password || process.env.TARGET_PASSWORD || "";

  if (!email || !password) {
    usage();
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    console.error("No user found with email:", email);
    process.exit(1);
  }

  user.password = password;
  await user.save();
  console.log(`Password updated for ${email}`);
  process.exit(0);
};

main().catch((err) => {
  console.error("Failed to set password:", err && err.message ? err.message : err);
  process.exit(1);
});
