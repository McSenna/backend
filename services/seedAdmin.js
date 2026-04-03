const User = require("../models/User");

const ADMIN_EMAIL = "maslog@admin.gov.ph";
const MIDWIFE_EMAIL = "midwife@maslog.gov.ph";
const DOCTOR_EMAIL = "doctor@maslog.gov.ph";
const ADMIN_SEED = {
  fullname: "System Administrator",
  dateOfBirth: new Date("2005-04-16"),
  email: ADMIN_EMAIL,
  profilePhoto: "",
  password: process.env.ADMIN_DEFAULT_PASSWORD || "MaslogAdmin@2025",
  verified: true,
  role: "admin",
  address: "Maslog, Eastern Samar",
  gender: "male",
};

const MIDWIFE_SEED = {
  fullname: "Mission Midwife",
  dateOfBirth: new Date("1990-01-15"),
  email: MIDWIFE_EMAIL,
  profilePhoto: "",
  password: process.env.MIDWIFE_DEFAULT_PASSWORD || "MaslogMidwife@2025",
  verified: true,
  role: "midwife",
  address: "Maslog, Eastern Samar",
  gender: "female",
};

const DOCTOR_SEED = {
  fullname: "Mission Doctor",
  dateOfBirth: new Date("1985-06-01"),
  email: DOCTOR_EMAIL,
  profilePhoto: "",
  password: process.env.DOCTOR_DEFAULT_PASSWORD || "MaslogDoctor@2025",
  verified: true,
  role: "doctor",
  address: "Maslog, Eastern Samar",
  gender: "male",
};

const seedAdmin = async () => {
  try {
    const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase().trim(), role: "admin" }).lean();
    if (!existing) {
      await User.create(ADMIN_SEED);
      console.log("Default admin account created for:", ADMIN_EMAIL);
    }

    const mid = await User.findOne({ email: MIDWIFE_EMAIL.toLowerCase().trim(), role: "midwife" }).lean();
    if (!mid) {
      await User.create(MIDWIFE_SEED);
      console.log("Default midwife account created for:", MIDWIFE_EMAIL);
    }

    const doc = await User.findOne({ email: DOCTOR_EMAIL.toLowerCase().trim(), role: "doctor" }).lean();
    if (!doc) {
      await User.create(DOCTOR_SEED);
      console.log("Default doctor account created for:", DOCTOR_EMAIL);
    }
  } catch (error) {
    console.error("Failed to seed admin/midwife accounts:", error.message);
  }
};

module.exports = { seedAdmin };