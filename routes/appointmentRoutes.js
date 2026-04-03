"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const missionController = require("../controllers/missionController");
const appointmentController = require("../controllers/appointmentController");

const router = express.Router();

const RESIDENT = ["resident"];
const STAFF = ["doctor", "admin", "midwife"];
const STAFF_ADMIN = ["doctor", "admin", "midwife"];

router.get("/consultation-categories", auth, missionController.getConsultationCategories);

router.post("/appointments", auth, roleCheck(RESIDENT), appointmentController.createAppointment);
router.get("/appointments/me", auth, roleCheck(RESIDENT), appointmentController.getMyAppointments);

router.get("/appointments/pending", auth, roleCheck(STAFF), appointmentController.getPendingAppointments);
router.get("/appointments", auth, roleCheck(STAFF), appointmentController.listAppointments);
router.get("/appointments/analytics/by-category", auth, roleCheck(STAFF), appointmentController.getAnalyticsByCategory);
router.get("/appointments/suggest-slot", auth, roleCheck(STAFF), appointmentController.suggestSlot);

router.patch("/appointments/:id/assign", auth, roleCheck(STAFF_ADMIN), appointmentController.assignAppointment);
router.patch("/appointments/:id/reassign", auth, roleCheck(STAFF_ADMIN), appointmentController.reassignAppointment);
router.patch("/appointments/:id/reject", auth, roleCheck(STAFF_ADMIN), appointmentController.rejectAppointment);

router.post("/mission-schedule", auth, roleCheck(STAFF_ADMIN), missionController.createMissionSchedule);
router.get("/mission-schedule", auth, roleCheck(STAFF_ADMIN), missionController.listMissionSchedules);
router.get("/mission-schedule/:id/available-slots", auth, roleCheck(STAFF_ADMIN), missionController.getAvailableSlots);
router.get("/mission-schedule/:id", auth, roleCheck(STAFF_ADMIN), missionController.getMissionSchedule);

router.patch("/mission-schedule/:id", auth, roleCheck(STAFF_ADMIN), missionController.updateMissionSchedule);
router.delete("/mission-schedule/:id", auth, roleCheck(STAFF_ADMIN), missionController.deleteMissionSchedule);

module.exports = router;
