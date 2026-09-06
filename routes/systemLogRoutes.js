"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const { getSystemLogs } = require("../controllers/systemLogController");

const router = express.Router();

router.get("/system-logs", auth, roleCheck(["admin"]), getSystemLogs);

module.exports = router;
