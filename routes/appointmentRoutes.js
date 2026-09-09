"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const missionController = require("../controllers/missionController");
const appointmentController = require("../controllers/appointmentController");

const router = express.Router();

const RESIDENT = ["resident"];

/**
 * Who may read a queue.
 *
 * BHW is included because BP Checking routes to them: without it their queue
 * exists in the routing table but is unreachable over HTTP. What each role
 * actually sees is still narrowed per-request by the service catalogue, so
 * adding a role here widens who can ask, never what any of them get back.
 */
const STAFF_READ = ["doctor", "admin", "midwife", "bhw"];

/**
 * Who may schedule, move or decline an appointment.
 *
 * Deliberately unchanged: these act on mission-schedule slots, which BHWs do
 * not manage today. Left as-is rather than widened silently — granting a new
 * role write access to the schedule is a decision for the health team, not a
 * side effect of fixing queue routing.
 */
const STAFF_ADMIN = ["doctor", "admin", "midwife"];

/**
 * Who may create, change or delete a mission schedule.
 *
 * Missions are the doctor's instrument: the schedule they open is what the
 * triage queue assigns every role's appointments into, so opening one is a
 * decision about the whole health team's day rather than about one service.
 * Midwives and BHWs work inside a mission, they do not call one — and the
 * check lives here rather than only on the button, so removing the button from
 * their UI is a courtesy and this is the actual rule.
 */
const MISSION_MANAGE = ["doctor", "admin"];

router.get("/consultation-categories", auth, missionController.getConsultationCategories);
// Which health workers may deliver a given service. Any signed-in user may
// read it: a resident needs it to fill in the booking form.
router.get("/appointment-providers", auth, appointmentController.listServiceProviders);

router.post("/appointments", auth, roleCheck(RESIDENT), appointmentController.createAppointment);
router.get("/appointments/me", auth, roleCheck(RESIDENT), appointmentController.getMyAppointments);

router.get("/appointments/pending", auth, roleCheck(STAFF_READ), appointmentController.getPendingAppointments);
router.get("/appointments", auth, roleCheck(STAFF_READ), appointmentController.listAppointments);
router.get("/appointments/overview", auth, roleCheck(STAFF_READ), appointmentController.getQueueOverview);
router.get("/appointments/analytics/by-category", auth, roleCheck(STAFF_READ), appointmentController.getAnalyticsByCategory);
router.get("/appointments/suggest-slot", auth, roleCheck(STAFF_ADMIN), appointmentController.suggestSlot);

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
