"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const missionController = require("../controllers/missionController");
const appointmentController = require("../controllers/appointmentController");
const medicalRecordController = require("../controllers/medicalRecordController");

const router = express.Router();

const RESIDENT = ["resident"];

const STAFF_READ = ["doctor", "admin", "midwife", "bhw"];

const STAFF_ADMIN = ["doctor", "admin", "midwife"];

const MISSION_MANAGE = ["doctor", "admin"];

router.get("/consultation-categories", auth, missionController.getConsultationCategories);
router.get("/appointment-providers", auth, appointmentController.listServiceProviders);

router.post("/appointments", auth, roleCheck(RESIDENT), appointmentController.createAppointment);
router.get("/appointments/me", auth, roleCheck(RESIDENT), appointmentController.getMyAppointments);

router.get("/appointments/pending", auth, roleCheck(STAFF_READ), appointmentController.getPendingAppointments);
router.get("/appointments", auth, roleCheck(STAFF_READ), appointmentController.listAppointments);
router.get("/appointments/overview", auth, roleCheck(STAFF_READ), appointmentController.getQueueOverview);
router.get("/appointments/analytics/by-category", auth, roleCheck(STAFF_READ), appointmentController.getAnalyticsByCategory);
router.get("/appointments/suggest-slot", auth, roleCheck(STAFF_ADMIN), appointmentController.suggestSlot);

router.get("/appointments/completion-forms", auth, roleCheck(STAFF_READ), medicalRecordController.getCompletionForms);
router.get("/appointments/completed", auth, roleCheck(STAFF_READ), medicalRecordController.listCompletedAppointments);
router.patch("/appointments/:id/processing", auth, roleCheck(STAFF_READ), medicalRecordController.startProcessing);
router.post("/appointments/:id/complete", auth, roleCheck(STAFF_READ), medicalRecordController.completeAppointment);

router.get("/medical-records/me", auth, roleCheck(RESIDENT), medicalRecordController.getMyMedicalRecords);
router.get("/medical-records/:id", auth, medicalRecordController.getMedicalRecord);

router.patch("/appointments/:id/assign", auth, roleCheck(STAFF_ADMIN), appointmentController.assignAppointment);
router.patch("/appointments/:id/reassign", auth, roleCheck(STAFF_ADMIN), appointmentController.reassignAppointment);
router.patch("/appointments/:id/reject", auth, roleCheck(STAFF_ADMIN), appointmentController.rejectAppointment);

router.post("/mission-schedule", auth, roleCheck(MISSION_MANAGE), missionController.createMissionSchedule);
router.get("/mission-schedule", auth, roleCheck(STAFF_ADMIN), missionController.listMissionSchedules);
router.get("/mission-schedule/:id/available-slots", auth, roleCheck(STAFF_ADMIN), missionController.getAvailableSlots);
router.get("/mission-schedule/:id", auth, roleCheck(STAFF_ADMIN), missionController.getMissionSchedule);

router.patch("/mission-schedule/:id", auth, roleCheck(MISSION_MANAGE), missionController.updateMissionSchedule);
router.delete("/mission-schedule/:id", auth, roleCheck(MISSION_MANAGE), missionController.deleteMissionSchedule);

module.exports = router;
