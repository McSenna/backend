"use strict";

const { createSystemLog } = require("../systemLogService");
const {
  loadScheduledAppointment,
  reprocessMissionQueue,
  sendScheduleEmail,
  notifyScheduleChange,
} = require("./scheduleNotifier");

const announceScheduleChange = async ({ req, appointment, missionScheduleId, plan }) => {
  const populated = await loadScheduledAppointment(appointment._id);
  const actorId = req.user.userId;

  const { resident, details } = await notifyScheduleChange({
    populated,
    fallbackResidentId: appointment.resident,
    actorId,
    notification: plan.notification,
    route: plan.route,
  });

  sendScheduleEmail(plan.sendEmail, resident, details, plan.emailFailureMessage);

  await reprocessMissionQueue(missionScheduleId, {
    staffId: actorId,
    route: plan.route,
    failureMessage: plan.queueFailureMessage,
  });

  await createSystemLog({
    req,
    action: plan.log.action,
    user: { _id: actorId, role: req.user.role },
    role: req.user.role,
    description: plan.log.description,
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: plan.log.metadata,
  });

  return populated;
};

module.exports = { announceScheduleChange };
