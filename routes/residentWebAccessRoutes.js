"use strict";
const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const requireResidentWebAccessAdmin = require("../middleware/residentWebAccessAdminMiddleware");
const { adminWriteLimiter } = require("../middleware/adminRateLimiter");
const access = require("../controllers/residentWebAccessController");
const router = express.Router();
const adminOnly = [auth, roleCheck(["admin"])];
const designatedRead = [...adminOnly, requireResidentWebAccessAdmin];
// The limiter runs first so refused attempts cannot flood the system log.
const designatedWrite = [...adminOnly, adminWriteLimiter, requireResidentWebAccessAdmin];
router.get("/admin/resident-web-access", ...designatedRead, access.getGlobal);
router.patch("/admin/resident-web-access", ...designatedWrite, access.setGlobal);
router.get("/admin/users/:id/web-access", ...designatedRead, access.getIndividual);
router.patch("/admin/users/:id/web-access", ...designatedWrite, access.setIndividual);
module.exports = router;
