"use strict";

const Appointment = require("../../models/Appointment");
const { CONSULTATION_CATEGORIES, getCategory } = require("../../config/consultationCategories");
const { conflict } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const QUEUED_SERVICE_KEYS = Object.freeze(
  CONSULTATION_CATEGORIES.filter((category) => category.scheduling === "queue").map((category) => category.key)
);

/** The lock every queued request of one resident takes, so two quick sends cannot both pass the check. */
const residentQueueLockKey = (residentId) => `doctor-queue:${String(residentId)}`;

/**
 * One doctor request waits in the queue per resident (kape, 2026-11-07). A
 * second request, of either doctor service, would hold two places for one
 * person. A request a mission change sent back to the queue counts as waiting.
 * Once it is scheduled, cancelled or declined, the resident may send another.
 */
const assertNoWaitingRequest = async ({ residentId, session }) => {
  const waiting = await Appointment.findOne({
    resident: residentId,
    consultationType: { $in: QUEUED_SERVICE_KEYS },
    status: "pending",
  })
    .select("consultationType")
    .session(session)
    .lean();
  if (!waiting) return;

  const label = getCategory(waiting.consultationType)?.label ?? "doctor";
  throw conflict(
    `You already have a ${label.toLowerCase()} request waiting in the queue. You can send a new doctor request once it is scheduled. To change it, cancel it from your appointments first.`,
    ERROR_CODES.DUPLICATE_BOOKING
  );
};

module.exports = { QUEUED_SERVICE_KEYS, assertNoWaitingRequest, residentQueueLockKey };
