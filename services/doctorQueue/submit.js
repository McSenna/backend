"use strict";

const Appointment = require("../../models/Appointment");
const { priorityOf } = require("../../utils/priorityQueue");
const { withBookingDayLock } = require("../appointment/dayLock");
const { findEarlierBooking } = require("../appointment/bookingReplay");
const { resolvePreferredProvider } = require("../appointment/providerService");
const { assertNoWaitingRequest, residentQueueLockKey } = require("./waitingGuard");

const QUEUED_NOTE = "Requested by resident, waiting in the queue for a doctor's schedule";

/**
 * Saves the request as pending with no mission, date or time. It is the
 * submission timestamp (`createdAt`) that orders it within its age group.
 *
 * Every queued request of one resident runs under the same lock, so of two
 * sends that race, the second sees the first and is refused (one waiting
 * request per resident). A retry of the first, with its request key, is
 * answered with that request instead; the unique (resident, bookingRequestKey)
 * index stays as the last line of defence.
 */
const commitQueuedRequest = async ({ request, resident, requestKey, now }) => {
  const providerId = await resolvePreferredProvider(request.preferredProvider, request.categoryKey);
  const { ageYears, group } = priorityOf(resident.dateOfBirth, now);

  return withBookingDayLock(residentQueueLockKey(resident._id), async (session) => {
    const earlier = await findEarlierBooking(resident._id, requestKey, session)?.lean();
    if (earlier) return { appointment: earlier, replayed: true, providerId };
    await assertNoWaitingRequest({ residentId: resident._id, session });

    const [appointment] = await Appointment.create(
      [
        {
          resident: resident._id,
          consultationType: request.categoryKey,
          description: request.description,
          additionalNotes: request.additionalNotes,
          preferredProvider: providerId,
          isUrgent: request.isUrgent,
          status: "pending",
          ageTier: group,
          prioritySortKey: group,
          ageAtSubmission: ageYears,
          bookingRequestKey: requestKey,
          statusHistory: [{ status: "pending", timestamp: now, changedBy: resident._id, note: QUEUED_NOTE }],
        },
      ],
      { session }
    );
    return { appointment, replayed: false, providerId };
  });
};

module.exports = { commitQueuedRequest };
