"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const { getAdminDashboard } = require("../controllers/dashboardController");
const { getResidentDashboard } = require("../controllers/residentDashboardController");
const { getStaffDashboard } = require("../controllers/staffDashboardController");

const router = express.Router();

router.get("/admin/dashboard", auth, roleCheck(["admin"]), getAdminDashboard);

router.get("/resident/dashboard", auth, roleCheck(["resident"]), getResidentDashboard);

router.get(
  "/staff/dashboard",
  auth,
  roleCheck(["doctor", "midwife", "bhw", "admin"]),
  getStaffDashboard
);

module.exports = router;
