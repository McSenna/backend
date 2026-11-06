"use strict";

const Appointment = require("../../models/Appointment");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { SLOT_OCCUPYING_STATUSES } = require("../queueScope");
const { addDays, dayKeyOf, dayStartOf } = require("../immunization/weeklyCalendar");
const { DAY_STATUS, daysOfMonth, describeDay, monthKeyOf, monthStartOf, scheduleSummary, toSlot } = require("./calendar");

/**
 * Every appointment holding a slot of this service in [from, to). Older visits
 * booked through a mission count too: they keep their time, and new bookings
 * work around them.
 */
const loadBookedBetween = (categoryKey, from, to, session = null) =>
  Appointment.find({
    consultationType: categoryKey,
    status: { $in: SLOT_OCCUPYING_STATUSES },
    slotStart: { $gte: from, $lt: to },
  })
    .select("_id slotStart slotEnd")
    .session(session)
    .lean();

const loadBookedOnDay = (categoryKey, dayStart, session = null) =>
  loadBookedBetween(categoryKey, dayStart, addDays(dayStart, 1), session);

const parseMonthParam = (raw) => {
  const monthStart = monthStartOf(raw);
  if (!monthStart) throw badRequest("The month must look like 2026-11.", ERROR_CODES.VALIDATION_ERROR);
  return monthStart;
};

const parseDateParam = (raw) => {
  const dayStart = dayStartOf(raw);
  if (!dayStart) throw badRequest("The date must be a real date, like 2026-11-09.", ERROR_CODES.VALIDATION_ERROR);
  return dayStart;
};

const bookedOn = (rows, dayStart) => {
  const key = dayKeyOf(dayStart);
  return rows.filter((row) => dayKeyOf(new Date(row.slotStart)) === key);
};

const publicDay = ({ open, ...day }) => day;

const dayWithSlots = (categoryKey, described) => ({
  ...publicDay(described),
  slots: described.open.map((start) => toSlot(categoryKey, start)),
});

/**
 * The calendar month and, when a date is chosen, its open slots. With neither
 * `month` nor `date`, it shows the current month and the first open day in it,
 * so the form opens with a date already chosen. Only open, future slots are
 * listed; booking re-checks the chosen one under the day lock.
 */
const listRegularOptions = async (
  categoryKey,
  { month = null, date = null, excludeAppointmentId = null, now = new Date() } = {}
) => {
  const chosenDay = date ? parseDateParam(date) : null;
  const monthStart = month
    ? parseMonthParam(month)
    : new Date((chosenDay ?? now).getFullYear(), (chosenDay ?? now).getMonth(), 1);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const rows = await loadBookedBetween(categoryKey, monthStart, monthEnd);
  const exclude = excludeAppointmentId ? String(excludeAppointmentId) : null;
  const describe = (dayStart, booked) => describeDay({ categoryKey, dayStart, booked, now, excludeAppointmentId: exclude });

  const days = daysOfMonth(monthStart).map((dayStart) => describe(dayStart, bookedOn(rows, dayStart)));
  const autoDay = !month && !date ? days.find((day) => day.status === DAY_STATUS.OPEN) : null;
  const shownDay = chosenDay ?? (autoDay ? dayStartOf(autoDay.dateKey) : null);

  let day = null;
  if (shownDay) {
    const insideMonth = shownDay >= monthStart && shownDay < monthEnd;
    const booked = insideMonth ? bookedOn(rows, shownDay) : await loadBookedOnDay(categoryKey, shownDay);
    day = dayWithSlots(categoryKey, describe(shownDay, booked));
  }

  return {
    consultationType: categoryKey,
    scheduling: "regular",
    schedule: scheduleSummary(categoryKey, now),
    month: { monthKey: monthKeyOf(monthStart), days: days.map(publicDay) },
    day,
  };
};

module.exports = { listRegularOptions, loadBookedOnDay };
