"use strict";

const Appointment = require("../../models/Appointment");
const { computeAgeYears, ageToTier } = require("../../utils/priorityQueue");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { assertNoSameDayBooking } = require("../appointment/bookingCommit");
const { findEarlierBooking } = require("../appointment/bookingReplay");
const { withBookingDayLock } = require("../appointment/dayLock");
const { dayLockKey } = require("../immunization/weeklyBooking");
const { endOfPosition, weeklySlotKey } = require("../immunization/weeklyCalendar");
const { loadBookedOnDay } = require("./availability");
const { isTaken } = require("./calendar");

const SLOT_TAKEN_MESSAGE = "That time was just booked by someone else. Please pick another time.";

/** Re-reads the day inside the lock, so a booking that committed a moment ago is seen. */
const assertStillOpen = async ({ categoryKey, dayStart, start, session, excludeAppointmentId = null }) => {
  const booked = await loadBookedOnDay(categoryKey, dayStart, session);
  if (isTaken({ categoryKey, start, booked, excludeAppointmentId })) {
    throw conflict(SLOT_TAKEN_MESSAGE, ERROR_CODES.SLOT_UNAVAILABLE);
  }
};

/** The slot fields a booking or a move writes; the unique slot key backs the day lock. */
const slotFields = (categoryKey, start) => {
  const end = endOfPosition(categoryKey, start);
  return {
    missionSchedule: null,
    assignedCategoryKey: categoryKey,
    assignedDurationMinutes: Math.round((end - start) / 60000),
    slotStart: start,
    slotEnd: end,
    immunizationSlotKey: weeklySlotKey(categoryKey, start),
  };
};

/**
 * Books the start the resident chose. Every booking of one service day takes
 * the same lock, so two residents racing for one slot are serialized and the
 * second sees the first as taken. Confirmed on creation, like mission bookings.
 */
const commitRegularBooking = ({ request, resident, requestKey, now }) =>
  withBookingDayLock(dayLockKey(request.categoryKey, request.dayStart), async (session) => {
    const replay = await findEarlierBooking(resident._id, requestKey, session);
    if (replay) return { appointment: replay, replayed: true };

    const { categoryKey, dayStart, slotStartDate } = request;
    await assertNoSameDayBooking({ residentId: resident._id, categoryKey, slotStartDate, session });
    await assertStillOpen({ categoryKey, dayStart, start: slotStartDate, session });

    const ageYears = computeAgeYears(resident.dateOfBirth);
    const ageTier = ageToTier(ageYears);
    const [appointment] = await Appointment.create(
      [
        {
          resident: resident._id,
          consultationType: categoryKey,
          description: request.description,
          additionalNotes: request.additionalNotes,
          status: "confirmed",
          ageTier,
          prioritySortKey: ageTier,
          ageAtSubmission: ageYears,
          ...slotFields(categoryKey, slotStartDate),
          assignedBy: null,
          assignedAt: now,
          approvedAt: now,
          bookingRequestKey: requestKey,
          statusHistory: [{ status: "confirmed", timestamp: now, changedBy: resident._id, note: "Booked by resident" }],
        },
      ],
      { session }
    );

    return { appointment, replayed: false, providerId: null };
  });

module.exports = { commitRegularBooking, assertStillOpen, slotFields };
