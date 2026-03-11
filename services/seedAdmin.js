const Resident = require("../models/User");

const ADMIN_EMAIL = "maslog@admin.gov.ph";
const ADMIN_SEED = {
  fullname: "Justin Valladolid",
  dateOfBirth: new Date("2005-04-16"),
  email: ADMIN_EMAIL,
  password: process.env.ADMIN_DEFAULT_PASSWORD || "MaslogAdmin@2025",
  verified: true,
  role: "admin",
  address: "Maslog, Eastern Samar",
  gender: "male",
};

const seedAdmin = async () => {
  try {
    const existing = await Resident.findOne({ email: ADMIN_EMAIL.toLowerCase().trim(), role: "admin" }).lean();
    if (existing) return;

    await Resident.create(ADMIN_SEED);
    console.log("Default admin account created for:", ADMIN_EMAIL);
  } catch (error) {
    console.error("Failed to seed admin account:", error.message);
  }
};

module.exports = { seedAdmin };