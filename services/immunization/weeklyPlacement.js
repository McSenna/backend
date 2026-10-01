"use strict";

const Appointment = require("../../models/Appointment");
const { pushStatusHistory } = require("../../models/Appointment");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { withBookingDayLock } = require("../appointment/dayLock");
const { byPriorityThenCreated, tagPendingAppointments } = require("../triage/triagePriority");
const { endOfPosition, upcomingDays } = require("./weeklyCalendar");
const { parseBookableDay } = require("./weeklyRequest");
const { dayLockKey, fullDayConflict } = require("./weeklyBooking");
const { loadBookedOnDay, openStarts } = require("./weeklySlots");

const STALE_MESSAGE = "This appointment has already been updated. Please refresh and try again.";

// The same rule the mission queue enforces: staff place pending requests in the
// order the Pending tab lists them (rescheduled first, then age tier, then age of request).
const assertNextInLine = async (appointment) => {
  const pending = await Appointment.find({ status: "pending", consultationType: appointment.consultationType })
    .populate("resident", "dateOfBirth")
    .exec();
  await tagPendingAppointments(pending);
  const [next] = pending.sort(byPriorityThenCreated);
  if (next && String(next._id) !== String(appointment._id)) {
    throw conflict(
      "A higher-priority patient is next in the queue and must be scheduled first.",
      ERROR_CODES.TRIAGE_ORDER_VIOLATION
    );
  }
};

const placeOnDay = ({ appointmentId, categoryKey, dayStart, staffId, now }) =>
  withBookingDayLock(dayLockKey(categoryKey, dayStart), async (session) => {
    const current = await Appointment.findById(appointmentId).session(session);
    if (!current || current.status !== "pending") throw conflict(STALE_MESSAGE, ERROR_CODES.INVALID_STATUS_TRANSITION);

    const booked = await loadBookedOnDay(categoryKey, dayStart, session);
    const [slotStart] = openStarts({ categoryKey, dayStart, booked, now });
    if (!slotStart) return null;

    const slotEnd = endOfPosition(categoryKey, slotStart);
    Object.assign(current, {
      status: "confirmed",
      missionSchedule: null,
      assignedCategoryKey: categoryKey,
      assignedDurationMinutes: Math.round((slotEnd - slotStart) / 60000),
      slotStart,
      slotEnd,
      immunizationSlotKey: slotStart.toISOString(),
      assignedBy: staffId,
      assignedAt: now,
      approvedAt: current.approvedAt ?? now,
    });
    pushStatusHistory(current, "confirmed", staffId, "Placed on the weekly schedule");
    await current.save({ session });
    return current;
  });

/**
 * Staff "assign" for an older pending weekly request: the earliest open
 * position on the named day, or on the first day with room. Never a mission.
 */
const placePendingWeekly = async ({ appointment, payload = {}, staffId, now = new Date() }) => {
  if (appointment.status !== "pending") {
    throw conflict(
      `Only pending appointments can be scheduled. This appointment is already ${appointment.status}.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }
  await assertNextInLine(appointment);

  const categoryKey = appointment.consultationType;
  const named = payload.appointmentDate ? parseBookableDay(categoryKey, payload.appointmentDate, now) : null;

  for (const dayStart of named ? [named] : upcomingDays(categoryKey, now)) {
    const placed = await placeOnDay({ appointmentId: appointment._id, categoryKey, dayStart, staffId, now });
    if (placed) return placed;
    if (named) throw fullDayConflict(categoryKey, dayStart);
  }
  throw conflict(
    "Every Wednesday in the booking window is full. Decline the request or try again later.",
    ERROR_CODES.SLOT_UNAVAILABLE
  );
};

module.exports = { placePendingWeekly };
