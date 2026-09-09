"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const { getAdminDashboard } = require("../controllers/dashboardController");
const { getResidentDashboard } = require("../controllers/residentDashboardController");

const router = express.Router();

// Aggregate analytics are admin-only; the same guard chain as /users.
router.get("/admin/dashboard", auth, roleCheck(["admin"]), getAdminDashboard);

// The resident's own dashboard. No id in the path or query — the controller
// reads the resident from the verified token, so one resident cannot request
// another's by changing a parameter.
router.get("/resident/dashboard", auth, roleCheck(["resident"]), getResidentDashboard);

module.exports = router;
