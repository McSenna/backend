"use strict";

const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { assignSlot, reassignSlot } = require("../../services/appointmentSchedulingService");
const { announceScheduleChange } = require("../../services/appointmentScheduleFlow");
const { assignPlan, reassignPlan } = require("./schedulePlans");

const scheduleHandler = ({ apply, buildPlan, message }) =>
  asyncHandler(async (req, res) => {
    const appointmentId = assertValidObjectId(req.params.id, "appointment");
    const { missionScheduleId, categoryKey } = req.body;

    const appointment = await apply({
      appointmentId,
      payload: req.body,
      staffId: req.user.userId,
    });

    const populated = await announceScheduleChange({
      req,
      appointment,
      missionScheduleId,
      plan: buildPlan({ missionScheduleId, categoryKey }),
    });

    return res.json({ success: true, message, appointment: populated });
  });

exports.assignAppointment = scheduleHandler({
  apply: assignSlot,
  buildPlan: assignPlan,
  message: "Appointment confirmed and scheduled",
});

exports.reassignAppointment = scheduleHandler({
  apply: reassignSlot,
  buildPlan: reassignPlan,
  message: "Appointment rescheduled",
});
