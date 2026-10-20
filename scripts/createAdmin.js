#!/usr/bin/env node
"use strict";

require("dotenv").config();
const connectDB = require("../config/db");
const User = require("../models/User");

const usage = () => {
  console.log("Usage: node backend/scripts/createAdmin.js --email admin@example.com --password Secret123 --fullname 'Admin Name' --gender male");
  console.log("Or set NEW_ADMIN_EMAIL, NEW_ADMIN_PASSWORD, NEW_ADMIN_FULLNAME, NEW_ADMIN_GENDER in environment.");
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
  const email = (opts.email || process.env.NEW_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = opts.password || process.env.NEW_ADMIN_PASSWORD || "";
  const fullname = opts.fullname || process.env.NEW_ADMIN_FULLNAME || "New Admin";
  const gender = (opts.gender || process.env.NEW_ADMIN_GENDER || "male").toLowerCase();

  if (!email || !password) {
    usage();
    process.exit(1);
  }

  await connectDB();

  // Check if a user with this email already exists
  const existing = await User.findOne({ email }).lean();
  if (existing) {
    console.error("A user with that email already exists:", existing.email);
    process.exit(1);
  }

  // Create admin account
  const payload = {
    fullname,
    email,
    password,
    verified: true,
    role: "admin",
    gender,
    profilePhoto: "",
    address: "",
  };

  const created = await User.create(payload);
  console.log("Admin account created:", created.email, created._id.toString());
  process.exit(0);
};

main().catch((err) => {
  console.error("Failed to create admin:", err && err.message ? err.message : err);
  process.exit(1);
});
