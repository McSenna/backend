"use strict";

// Medical Records Masterlist. Staff only; residents read their own records
// through /medical-records/me. Searches are POSTs so names and record
// references stay out of URLs and request logs. Deleted documents remain in the protected audit collection.

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const controller = require("../controllers/medicalRecord/masterlistController");

const router = express.Router();
const staffOnly = [auth, roleCheck(["admin", "doctor", "midwife", "bhw"])];
const clinicalOnly = [auth, roleCheck(["doctor", "midwife", "bhw"])];
const BASE = "/medical-record-masterlist";

router.post(`${BASE}/delete`, ...clinicalOnly, controller.deleteRecord);
router.post(`${BASE}/search`, ...staffOnly, controller.searchRecords);
router.get(`${BASE}/summary`, ...staffOnly, controller.getSummary);
router.post(`${BASE}/identities/search`, ...staffOnly, controller.searchIdentities);
router.post(BASE, ...clinicalOnly, controller.createRecord);
router.get(`${BASE}/:id`, ...staffOnly, controller.getRecord);
router.patch(`${BASE}/:id`, ...clinicalOnly, controller.updateRecord);

module.exports = router;
