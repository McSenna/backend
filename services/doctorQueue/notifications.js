"use strict";

const Notification = require("../../models/Notification");
const { getCategory } = require("../../config/consultationCategories");
const logger = require("../../utils/logger");
const { formatAppointmentDetails } = require("../appointment/notifications");

const DUPLICATE_KEY = 11000;

const serviceLabelOf = (categoryKey) => getCategory(categoryKey)?.label ?? "appointment";

/**
 * One notification per dedupe key: a retried request or a repeated queue run
 * finds the key taken and sends nothing. Delivery problems are logged, never
 * thrown, because the appointment itself is already saved when this runs.
 */
const createOnce = async (doc, context) => {
  try {
    await Notification.create(doc);
    return true;
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) return false;
    logger.warn("Queue notification failed", { route: context, errorName: error?.name, errorMessage: error?.message });
    return false;
  }
};

/** Receipt for a new request: it is in the queue and has no date or time yet. */
const announceQueued = (appointment) =>
  createOnce(
    {
      recipient: appointment.resident?._id ?? appointment.resident,
      appointment: appointment._id,
      dedupeKey: `appointment-queued:${appointment._id}`,
      type: "appointment_queued",
      title: "Appointment request queued",
      body: `Your ${serviceLabelOf(appointment.consultationType)} request has been queued. Your appointment date and time will be assigned when a doctor's medical mission schedule becomes available. We will notify you once it is scheduled.`,
      time: "",
      tone: "info",
    },
    "doctor-queue-submit"
  );

/**
 * A confirmed visit sent back to the queue because its mission was edited or
 * removed. It keeps its original request time, so its place in line is kept.
 */
const announceReturnedToQueue = ({ _id, resident, consultationType, slotStart }) => {
  const when = slotStart ? formatAppointmentDetails(slotStart) : null;
  const previous = when ? ` on ${when.date} at ${when.time}` : "";
  return createOnce(
    {
      recipient: resident,
      appointment: _id,
      dedupeKey: `appointment-requeued:${_id}:${slotStart ? new Date(slotStart).getTime() : "none"}`,
      type: "appointment_queued",
      title: "Appointment moved back to the queue",
      body: `Your ${serviceLabelOf(consultationType)} appointment${previous} was moved back to the queue because the medical mission schedule changed. Your place in the queue is kept, and we will notify you when a new date and time is assigned.`,
      time: "",
      tone: "warning",
    },
    "doctor-queue-release"
  );
};

module.exports = { announceQueued, announceReturnedToQueue };
