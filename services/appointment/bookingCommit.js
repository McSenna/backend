"use strict";

const Appointment = require("../../models/Appointment");
const { QUEUE_ACTIVE_STATUSES } = require("../../models/Appointment");
const { getCategory } = require("../../config/consultationCategories");
const { computeAgeYears, ageToTier } = require("../../utils/priorityQueue");
const { listAvailableStarts, listOpenStarts } = require("../../utils/slotAvailability");
const { todayBounds } = require("../../utils/dateWindow");
const { badRequest, conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { findEarlierBooking } = require("./bookingReplay");
const { resolvePreferredProvider } = require("./providerService");
const { loadMissionOrFail } = require("./lookup");
const { assertMissionOffersCategory, loadBookedForMission, missionDurationFor } = require("./slotService");
const { withMissionSlotLock } = require("./slotLock");

const isSameStart = (start) => (iso) => new Date(iso).getTime() === start.getTime();

const formatWhen = (date) =>
  `${date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} at ${date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;

// A resident books for themself, so a second visit for the same service on the
// same day is almost always an accidental repeat from a fresh form.
const assertNoSameDayBooking = async ({ residentId, categoryKey, slotStartDate, session }) => {
  const { start, end } = todayBounds(slotStartDate);
  const existing = await Appointment.findOne({
    resident: residentId,
    consultationType: categoryKey,
    status: { $in: QUEUE_ACTIVE_STATUSES },
    slotStart: { $gte: start, $lt: end },
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

/** The start must be on the mission's slot grid and still free against what is committed now. */
const assertStartIsOpen = ({ mission, booked, durationMinutes, slotStartDate, now }) => {
  const matches = isSameStart(slotStartDate);
  if (listOpenStarts(mission, booked, durationMinutes, null, now.getTime()).some(matches)) return;

  if (!listAvailableStarts(mission, [], durationMinutes, null).some(matches)) {
    throw badRequest(
      "That time is not one of this day's appointment times. Please pick a time from the list.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  throw conflict(
    "That time was just booked by someone else. Please pick another time.",
    ERROR_CODES.SLOT_UNAVAILABLE
  );
};

/**
 * Books a mission service (everything except the weekly ones) inside the
 * mission lock, so two residents choosing the same start are serialized and
 * the second sees the first one's slot as taken. Confirmed on creation.
 */
const commitMissionBooking = async ({ request, resident, requestKey, now }) => {
  const { categoryKey, slotStartDate } = request;
  const mission = await loadMissionOrFail(request.missionId);
  assertMissionOffersCategory(mission, categoryKey);
  const durationMinutes = missionDurationFor(mission, categoryKey);
  const providerId = await resolvePreferredProvider(request.preferredProvider, categoryKey);
  const ageYears = computeAgeYears(resident.dateOfBirth);
  const ageTier = ageToTier(ageYears);

  return withMissionSlotLock(mission._id, async (session) => {
    const replay = await findEarlierBooking(resident._id, requestKey, session);
    if (replay) return { appointment: replay, replayed: true };

    await assertNoSameDayBooking({ residentId: resident._id, categoryKey, slotStartDate, session });

    const booked = await loadBookedForMission(mission._id, session);
    assertStartIsOpen({ mission, booked, durationMinutes, slotStartDate, now });

    const [appointment] = await Appointment.create(
      [
        {
          resident: resident._id,
          consultationType: categoryKey,
          description: request.description,
          additionalNotes: request.additionalNotes,
          preferredProvider: providerId,
          isUrgent: request.isUrgent,
          status: "confirmed",
          ageTier,
          prioritySortKey: ageTier,
          ageAtSubmission: ageYears,
          missionSchedule: mission._id,
          assignedCategoryKey: categoryKey,
          assignedDurationMinutes: durationMinutes,
          slotStart: slotStartDate,
          slotEnd: new Date(slotStartDate.getTime() + durationMinutes * 60 * 1000),
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

    return { appointment, replayed: false, providerId };
  });
};

module.exports = { commitMissionBooking };
