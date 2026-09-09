"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  getSystemLogs,
  getSystemLogStats,
  exportSystemLogs,
} = require("../controllers/systemLogController");

const router = express.Router();

router.get("/system-logs/stats", auth, roleCheck(["admin"]), getSystemLogStats);
router.get("/system-logs/export", auth, roleCheck(["admin"]), exportSystemLogs);
router.get("/system-logs", auth, roleCheck(["admin"]), getSystemLogs);

module.exports = router;
