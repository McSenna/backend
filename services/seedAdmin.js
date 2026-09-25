const User = require("../models/User");
const { RESIDENCY } = require("../config/residency");

const ADMIN_EMAIL = "maslog@admin.gov.ph";
const MIDWIFE_EMAIL = "midwife@maslog.gov.ph";
const DOCTOR_EMAIL = "doctor@maslog.gov.ph";
const BHW_EMAIL = "bhw@maslog.gov.ph";
const HEALTH_CENTER_ADDRESS = `${RESIDENCY.barangay}, ${RESIDENCY.cityMunicipality}, ${RESIDENCY.province}`;

const ADMIN_SEED = {
  fullname: "System Administrator",
  dateOfBirth: new Date("2005-04-16"),
  email: ADMIN_EMAIL,
  profilePhoto: "",
  password: process.env.ADMIN_DEFAULT_PASSWORD || "MaslogAdmin@2025",
  verified: true,
  role: "admin",
  address: HEALTH_CENTER_ADDRESS,
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
  address: HEALTH_CENTER_ADDRESS,
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
  address: HEALTH_CENTER_ADDRESS,
  gender: "male",
};

const BHW_SEED = {
  fullname: "Mission BHW",
  dateOfBirth: new Date("1995-12-10"),
  email: BHW_EMAIL,
  profilePhoto: "",
  password: process.env.BHW_DEFAULT_PASSWORD || "MaslogBHW@2025",
  verified: true,
  role: "bhw",
  address: HEALTH_CENTER_ADDRESS,
  gender: "female",
};

const DEFAULT_ACCOUNTS = [ADMIN_SEED, MIDWIFE_SEED, DOCTOR_SEED, BHW_SEED];

const seedAdmin = async () => {
  try {
    for (const seed of DEFAULT_ACCOUNTS) {
      const existing = await User.findOne({ email: seed.email, role: seed.role }).lean();
      if (!existing) {
        await User.create(seed);
        console.log(`Default ${seed.role} account created for:`, seed.email);
      }
    }
  } catch (error) {
    console.error("Failed to seed default staff accounts:", error.message);
  }
};

module.exports = { seedAdmin };
