"use strict";

/** In-app notices for a moved appointment: the resident, and the staff member who placed it, if any. */
const buildRescheduleNotifications = ({ appointment, serviceLabel, labels, staffId }) => {
  const when = `${labels.date} at ${labels.time}`;

  return [
    {
      recipient: appointment.resident,
      appointment: appointment._id,
      type: "appointment_rescheduled",
      title: "Appointment Rescheduled",
      body: `Your ${serviceLabel} appointment has been rescheduled to ${when}.`,
      time: labels.time,
      tone: "info",
    },
    staffId
      ? {
          recipient: staffId,
          appointment: appointment._id,
          type: "appointment_rescheduled",
          title: "Appointment Rescheduled by Resident",
          body: `A ${serviceLabel} appointment you scheduled was moved by the resident to ${when}.`,
          time: labels.time,
          tone: "info",
        }
      : null,
  ];
};

module.exports = { buildRescheduleNotifications };
