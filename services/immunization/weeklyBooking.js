"use strict";

const Appointment = require("../../models/Appointment");
const { QUEUE_ACTIVE_STATUSES } = require("../../models/Appointment");
const { getCategory } = require("../../config/consultationCategories");
const { computeAgeYears, ageToTier } = require("../../utils/priorityQueue");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { findEarlierBooking } = require("../appointment/bookingReplay");
const { withBookingDayLock } = require("../appointment/dayLock");
const { addDays, dayKeyOf, endOfPosition } = require("./weeklyCalendar");
const { loadBookedOnDay, openStarts } = require("./weeklySlots");

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatDay = (date) =>
  date.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
const formatTime = (date) => date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

/** The lock that serializes every position handed out for one service day. */
const dayLockKey = (categoryKey, dayStart) => `${categoryKey}:${dayKeyOf(dayStart)}`;

const fullDayConflict = (categoryKey, dayStart) =>
  conflict(
    `No ${(getCategory(categoryKey)?.label ?? "appointment").toLowerCase()} times are left on ${formatDay(dayStart)}. Please choose another Wednesday.`,
    ERROR_CODES.SLOT_UNAVAILABLE
  );

// One parent may book several children on one Wednesday, but the same child
// twice is an accidental repeat. Messages never name the child: errors are logged.
const assertChildNotBooked = async ({ residentId, request, session }) => {
  const existing = await Appointment.findOne({
    resident: residentId,
    consultationType: request.categoryKey,
    childName: new RegExp(`^${escapeRegex(request.childName)}$`, "i"),
    childDateOfBirth: request.childDateOfBirth,
    status: { $in: QUEUE_ACTIVE_STATUSES },
    slotStart: { $gte: request.dayStart, $lt: addDays(request.dayStart, 1) },
  })
    .select("slotStart")
    .session(session)
    .lean();
  if (!existing) return;

  throw conflict(
    `This child already has an appointment on ${formatDay(existing.slotStart)} at ${formatTime(existing.slotStart)}. Open it from your appointments to change it.`,
    ERROR_CODES.DUPLICATE_BOOKING
  );
};

/**
 * First come, first served: inside the day lock the booking takes the earliest
 * open position, so the order bookings commit in is the order of their times.
 * The resident never names a time, and no reason or notes are stored.
 */
const commitWeeklyBooking = ({ request, resident, requestKey, now }) =>
  withBookingDayLock(dayLockKey(request.categoryKey, request.dayStart), async (session) => {
    const replay = await findEarlierBooking(resident._id, requestKey, session);
    if (replay) return { appointment: replay, replayed: true };

    await assertChildNotBooked({ residentId: resident._id, request, session });

    const { categoryKey, dayStart } = request;
    const booked = await loadBookedOnDay(categoryKey, dayStart, session);
    const [slotStart] = openStarts({ categoryKey, dayStart, booked, now });
    if (!slotStart) throw fullDayConflict(categoryKey, dayStart);

    // The patient is the child, so the priority tier follows the child's age.
    const ageYears = computeAgeYears(request.childDateOfBirth);
    const ageTier = ageToTier(ageYears);
    const slotEnd = endOfPosition(categoryKey, slotStart);

    const [appointment] = await Appointment.create(
      [
        {
          resident: resident._id,
          consultationType: categoryKey,
          childName: request.childName,
          childDateOfBirth: request.childDateOfBirth,
          status: "confirmed",
          ageTier,
          prioritySortKey: ageTier,
          ageAtSubmission: ageYears,
          missionSchedule: null,
          assignedCategoryKey: categoryKey,
          assignedDurationMinutes: Math.round((slotEnd - slotStart) / 60000),
          slotStart,
          slotEnd,
          immunizationSlotKey: slotStart.toISOString(),
          assignedBy: null,
          assignedAt: now,
          approvedAt: now,
          bookingRequestKey: requestKey,
          statusHistory: [
            { status: "confirmed", timestamp: now, changedBy: resident._id, note: "Booked by resident" },
          ],
        },
      ],
      { session }
    );

    return { appointment, replayed: false, providerId: null };
  });

module.exports = { commitWeeklyBooking, dayLockKey, fullDayConflict };
