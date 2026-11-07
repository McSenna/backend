"use strict";

const Appointment = require("../../models/Appointment");
const { QUEUE_ACTIVE_STATUSES } = require("../../models/Appointment");
const { getCategory } = require("../../config/consultationCategories");
const { todayBounds } = require("../../utils/dateWindow");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const formatWhen = (date) =>
  `${date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} at ${date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;

// A resident books for themself, so a second visit for the same service on the
// same day is almost always an accidental repeat from a fresh form.
// A reschedule passes its own appointment as `excludeAppointmentId`.
const assertNoSameDayBooking = async ({ residentId, categoryKey, slotStartDate, session, excludeAppointmentId = null }) => {
  const { start, end } = todayBounds(slotStartDate);
  const existing = await Appointment.findOne({
    resident: residentId,
    consultationType: categoryKey,
    status: { $in: QUEUE_ACTIVE_STATUSES },
    slotStart: { $gte: start, $lt: end },
    ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}),
  })
    .select("slotStart")
    .session(session)
    .lean();
  if (!existing) return;

  const label = getCategory(categoryKey)?.label ?? "appointment";
  throw conflict(
    `You already have a ${label} appointment on ${formatWhen(existing.slotStart)}. Open it from your appointments to change the time.`,
    ERROR_CODES.DUPLICATE_BOOKING
  );
};

module.exports = { assertNoSameDayBooking };
