"use strict";

const Appointment = require("../../models/Appointment");
const logger = require("../../utils/logger");
const { processMissionSchedulePriorityQueue } = require("../triageQueue");
const {
  formatAppointmentDetails,
  formatConsultationTypeLabel,
  formatSlotStartForNotification,
  truncateNotificationBody,
  createNotifications,
} = require("./notifications");

const loadScheduledAppointment = (appointmentId) =>
  Appointment.findById(appointmentId)
    .populate("resident", "fullname email")
    .populate("assignedBy", "fullname")
    .populate("missionSchedule")
    .lean();

const buildScheduleDetails = (populated) => {
  const doctorLabel = populated.assignedBy?.fullname ?? null;
  const appointmentTypeLabel = formatConsultationTypeLabel(populated.consultationType);
  return {
    doctorLabel,
    appointmentTypeLabel,
    details: {
      ...formatAppointmentDetails(populated.slotStart, doctorLabel, null),
      appointmentType: appointmentTypeLabel,
    },
    timeLabel: formatSlotStartForNotification(populated.slotStart),
  };
};

const reprocessMissionQueue = async (missionScheduleId, { staffId, route, failureMessage }) => {
  try {
    await processMissionSchedulePriorityQueue(missionScheduleId, { staffId });
  } catch (queueError) {
    logger.warn(failureMessage, {
      route,
      errorName: queueError?.name,
      errorMessage: queueError?.message,
    });
  }
};

const sendScheduleEmail = (sendEmail, resident, details, failureMessage) => {
  if (!resident?.email) return;
  void sendEmail(resident.email, resident.fullname, details).catch((emailError) => {
    logger.warn(failureMessage, {
      errorName: emailError?.name,
      errorCode: emailError?.code,
    });
  });
};

const notifyScheduleChange = async ({
  populated,
  fallbackResidentId,
  actorId,
  notification,
  route,
}) => {
  const { doctorLabel, appointmentTypeLabel, details, timeLabel } = buildScheduleDetails(populated);
  const resident = populated.resident;

  await createNotifications(
    [
      {
        recipient: resident?._id ?? fallbackResidentId,
        appointment: populated._id,
        type: notification.type,
        title: notification.title,
        body: truncateNotificationBody(
          notification.residentBody({ appointmentTypeLabel, details, doctorLabel })
        ),
        time: timeLabel,
        tone: notification.tone,
      },
      {
        recipient: actorId,
        appointment: populated._id,
        type: notification.type,
        title: notification.title,
        body: truncateNotificationBody(
          notification.actorBody({ appointmentTypeLabel, residentName: resident?.fullname })
        ),
        time: timeLabel,
        tone: notification.tone,
      },
    ],
    route
  );

  return { resident, details };
};

module.exports = {
  loadScheduledAppointment,
  buildScheduleDetails,
  reprocessMissionQueue,
  sendScheduleEmail,
  notifyScheduleChange,
};
