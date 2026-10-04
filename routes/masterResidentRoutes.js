"use strict";

// Barangay Master List endpoints. Admin-only and separate from every
// user-account route; residents and other staff get 403.

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  listMasterResidents,
  getMasterResident,
  createMasterResident,
  updateMasterResident,
  setMasterResidentStatus,
  importMasterResidents,
} = require("../controllers/masterResidentController");

const router = express.Router();
const adminOnly = [auth, roleCheck(["admin"])];

router.get("/admin/master-residents", ...adminOnly, listMasterResidents);
router.post("/admin/master-residents", ...adminOnly, createMasterResident);
router.post("/admin/master-residents/import", ...adminOnly, importMasterResidents);
router.get("/admin/master-residents/:id", ...adminOnly, getMasterResident);
router.patch("/admin/master-residents/:id", ...adminOnly, updateMasterResident);
router.patch("/admin/master-residents/:id/status", ...adminOnly, setMasterResidentStatus);

module.exports = router;
