"use strict";

// Medical Records Masterlist. Staff only; residents read their own records
// through /medical-records/me. Searches are POSTs so names and record
// references stay out of URLs and request logs. There is no delete route.

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const controller = require("../controllers/medicalRecord/masterlistController");

const router = express.Router();
const staffOnly = [auth, roleCheck(["admin", "doctor", "midwife", "bhw"])];
const BASE = "/medical-record-masterlist";

router.post(`${BASE}/search`, ...staffOnly, controller.searchRecords);
router.get(`${BASE}/summary`, ...staffOnly, controller.getSummary);
router.post(`${BASE}/identities/search`, ...staffOnly, controller.searchIdentities);
router.post(BASE, ...staffOnly, controller.createRecord);
router.get(`${BASE}/:id`, ...staffOnly, controller.getRecord);
router.patch(`${BASE}/:id`, ...staffOnly, controller.updateRecord);

module.exports = router;
