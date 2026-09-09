"use strict";

const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const MissionSchedule = require("../models/MissionSchedule");
const User = require("../models/User");
const {
  CONSULTATION_CATEGORIES,
  QUEUE_ROLES,
  getCategory,
  getResidentBookableCategories,
  getEligibleProviderRoles,
  getCategoryKeysForRole,
  getQueueRole,
  isProviderRoleAllowed,
  validateDurationForCategory,
} = require("../config/consultationCategories");
const { BLOCKED_STATUSES, resolveUserStatus } = require("../models/User");
const { computeAgeYears, ageToTier } = require("../utils/priorityQueue");
const {
  processMissionSchedulePriorityQueue,
  processUpcomingMissionSchedulesPriorityQueue,
  getFirstAssignablePendingAppointmentForMission,
} = require("../services/triageQueue");
const {
  getMissionDayWindows,
  isIntervalInsideWindows,
  hasConflict,
  suggestNextAvailableSlot,
} = require("../utils/slotAvailability");
const {
  sendAppointmentConfirmationEmail,
  sendAppointmentRescheduledEmail,
  sendAppointmentDeclinedEmail,
} = require("../services/mailer");
const Notification = require("../models/Notification");
const { createSystemLog } = require("../services/systemLogService");
const asyncHandler = require("../utils/asyncHandler");
const logger = require("../utils/logger");
const { assertValidObjectId } = require("../utils/objectId");
const { badRequest, notFound, conflict } = require("../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../utils/errorCodes");

const STAFF_ROLES = ["doctor", "admin", "midwife", "bhw"];
const BOOKED_STATUSES = ["confirmed", "rescheduled"];

/**
 * Which services this request is allowed to see, and which it asked for.
 *
 * The signed-in role is the ceiling, always — a doctor asking for `?role=bhw`
 * gets their own services back, not the BHW's. Only admin, who oversees every
 * queue, can move the scope with `role`, which is what drives the
 * All / Doctor / Midwife / BHW filter on the admin screen.
 *
 * Returning the key list rather than the role is deliberate: the appointment
 * stores a service, not a role, so the queue a record belongs to is derived
 * from its service every time it is read and cannot go stale.
 */
function resolveQueueScope(req) {
  const signedInRole = String(req.user?.role || "").trim().toLowerCase();
  const isAdmin = signedInRole === "admin";

  const requestedRole = String(req.query?.role || "").trim().toLowerCase();
  const scopeRole =
    isAdmin && QUEUE_ROLES.includes(requestedRole) ? requestedRole : signedInRole;

  // Admin with no explicit role sees every queue — and `null` rather than the
  // list of current services, so a record written against a service that has
  // since been retired still appears for them instead of silently vanishing
  // from the only view that is supposed to show everything.
  if (isAdmin && !QUEUE_ROLES.includes(requestedRole)) {
    return { scopeRole: "admin", categoryKeys: null };
  }

  return { scopeRole, categoryKeys: getCategoryKeysForRole(scopeRole) };
}

/**
 * Narrows a scope to one service, when the caller asked for one.
 *
 * Intersected with the role scope rather than replacing it, so `?categoryKey=`
 * can never reach a service the signed-in role does not own.
 */
function applyCategoryFilter(categoryKeys, requestedKey) {
  const key = String(requestedKey || "").trim();
  if (!key) return categoryKeys;
  // `null` is the unrestricted admin scope, which any single service narrows.
  if (categoryKeys === null) return [key];
  return categoryKeys.includes(key) ? [key] : [];
}

/** Builds the service clause, omitting it entirely for an unrestricted scope. */
function queueFilter(visibleKeys) {
  return visibleKeys === null ? {} : { consultationType: { $in: visibleKeys } };
}

/** Stamps the owning role onto a record, so clients never re-derive routing. */
function withQueueRole(appointment) {
  return { ...appointment, queueRole: getQueueRole(appointment.consultationType) };
}

async function loadBookedForMission(missionId, excludeId) {
  return Appointment.find({
    missionSchedule: missionId,
    status: { $in: BOOKED_STATUSES },
  })
    .select("slotStart slotEnd _id")
    .lean();
}

function formatAppointmentDetails(slotStart, workerLabel, locationLabel) {
  const d = new Date(slotStart);
  return {
    date: d.toLocaleDateString("en-PH", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    time: d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
    worker: workerLabel || "Medical mission team",
    location: locationLabel || "Barangay health mission site",
  };
}

function formatConsultationTypeLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSlotStartForNotification(slotStart) {
  if (!slotStart) return "";
  const d = new Date(slotStart);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateNotificationBody(text, maxLen = 1000) {
  const s = String(text ?? "");
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 3)) + "...";
}

/**
 * Notification fan-out for a write that has already committed.
 *
 * These are awaited so the recipient sees the notification as soon as the
 * response lands, but a failure here must not report the appointment change
 * itself as failed — the database is already updated, and a 500 would push
 * staff into retrying an operation that actually succeeded.
 */
async function createNotifications(docs, context) {
  try {
    await Promise.all(docs.map((doc) => Notification.create(doc)));
  } catch (error) {
    logger.warn("Notification delivery failed", {
      route: context,
      errorName: error?.name,
      errorMessage: error?.message,
    });
  }
}

/**
 * The health workers a resident may request for a given service.
 *
 * The eligible roles come from the service catalogue rather than from
 * anything the caller sends, and only accounts an administrator has left
 * active are offered. Deliberately narrow in what it returns — a resident
 * choosing a provider needs a name and a role, not a staff directory.
 */
exports.listServiceProviders = asyncHandler(async (req, res) => {
  const key = String(req.query.serviceType || req.query.consultationType || "").trim();
  if (!key) {
    throw badRequest("A service type is required.", ERROR_CODES.MISSING_FIELDS);
  }

  const category = getCategory(key);
  if (!category) {
    throw badRequest("The selected service is not available.", ERROR_CODES.VALIDATION_ERROR);
  }

  const roles = getEligibleProviderRoles(key);
  const staff = await User.find({ role: { $in: roles }, verified: true })
    .select("_id fullname role status verified profilePhoto")
    .sort({ fullname: 1 })
    .lean();

  const providers = staff
    .filter((member) => !BLOCKED_STATUSES.includes(resolveUserStatus(member)))
    .map((member) => ({
      _id: String(member._id),
      fullname: member.fullname,
      role: member.role,
      profilePhoto: member.profilePhoto || null,
    }));

  return res.json({
    success: true,
    message: "Healthcare providers loaded successfully.",
    serviceType: key,
    eligibleRoles: roles,
    providers,
  });
});

exports.createAppointment = asyncHandler(async (req, res) => {
  const { consultationType, description, additionalNotes, preferredProvider, isUrgent } = req.body;
  if (!consultationType) {
    throw badRequest("Please select a service type.", ERROR_CODES.MISSING_FIELDS);
  }
  const key = String(consultationType).trim();

  // Resident-bookable rather than merely known: the staff scheduling catalogue
  // may hold services that are not offered on the booking form.
  const bookable = getResidentBookableCategories().some((c) => c.key === key);
  if (!bookable) {
    throw badRequest("The selected service is not available.", ERROR_CODES.VALIDATION_ERROR);
  }

  const user = await User.findById(req.user.userId).lean();
  if (!user) {
    throw notFound("Your account could not be found.", ERROR_CODES.USER_NOT_FOUND);
  }

  // The provider is re-validated here rather than trusted from the form: the
  // client was handed a filtered list, but nothing stops a caller posting an
  // id that was never on it.
  let providerId = null;
  if (preferredProvider) {
    providerId = assertValidObjectId(preferredProvider, "healthcare provider");
    const provider = await User.findById(providerId)
      .select("_id role verified status")
      .lean();

    if (!provider || !provider.verified || BLOCKED_STATUSES.includes(resolveUserStatus(provider))) {
      throw badRequest(
        "The selected healthcare provider is not available.",
        ERROR_CODES.VALIDATION_ERROR
      );
    }
    if (!isProviderRoleAllowed(key, provider.role)) {
      throw badRequest(
        `${getCategory(key).label} is not handled by the selected healthcare provider.`,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
  }

  const age = computeAgeYears(user.dateOfBirth);
  const priorityTag = ageToTier(age);

  const appt = await Appointment.create({
    resident: user._id,
    consultationType: key,
    description: typeof description === "string" ? description.trim().slice(0, 4000) : "",
    additionalNotes:
      typeof additionalNotes === "string" ? additionalNotes.trim().slice(0, 1000) : "",
    preferredProvider: providerId,
    isUrgent: Boolean(isUrgent),
    status: "pending",
    ageTier: priorityTag,
    prioritySortKey: priorityTag,
    ageAtSubmission: age,
  });

  // Reprocess queue so the new appointment is triaged immediately (priority + FIFO).
  // In auto-assign flow we do not have a staff actor, so assignedBy remains null.
  await processUpcomingMissionSchedulesPriorityQueue({ staffId: null });

  const populated = await Appointment.findById(appt._id)
    .populate("resident", "fullname email dateOfBirth")
    .populate("preferredProvider", "fullname role")
    .populate("missionSchedule", "date morningStart morningEnd afternoonStart afternoonEnd")
    .lean();

  await createSystemLog({
    req,
    action: "APPOINTMENT_CREATED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Resident submitted a new appointment request",
    resource: "Appointment",
    resourceId: String(appt._id),
    metadata: {
      consultationType: key,
      preferredProvider: providerId ? String(providerId) : null,
      isUrgent: Boolean(isUrgent),
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Your appointment is in queue. Please wait for the doctor to assign your schedule.",
    appointment: populated,
  });
});

exports.getMyAppointments = asyncHandler(async (req, res) => {
  const list = await Appointment.find({ resident: req.user.userId })
    .sort({ createdAt: -1 })
    .populate("missionSchedule", "date morningStart morningEnd afternoonStart afternoonEnd")
    .populate("preferredProvider", "fullname role")
    .populate("assignedBy", "fullname role")
    .lean();
  return res.json({
    success: true,
    message: "Appointments loaded successfully.",
    appointments: list,
  });
});

/**
 * The pending triage queue, scoped to the caller's own services.
 *
 * Previously every staff member saw every pending appointment, so a midwife's
 * prenatal cases sat in the doctor's queue and a BP check sat in both. The
 * service decides the queue, so the filter is by service key — the record
 * itself is never tagged with a role that could drift from its service.
 */
exports.getPendingAppointments = asyncHandler(async (req, res) => {
  const { scopeRole, categoryKeys } = resolveQueueScope(req);
  const visibleKeys = applyCategoryFilter(categoryKeys, req.query?.categoryKey);

  const pending = await Appointment.find({
    status: "pending",
    ...queueFilter(visibleKeys),
  })
    .populate("resident", "fullname email dateOfBirth gender")
    .lean();

  const bulkOps = [];
  for (const appt of pending) {
    const age = computeAgeYears(appt.resident?.dateOfBirth);
    const priorityTag = ageToTier(age);

    const shouldUpdate =
      appt.ageTier !== priorityTag || appt.prioritySortKey !== priorityTag || appt.ageAtSubmission !== age;

    if (shouldUpdate) {
      bulkOps.push({
        updateOne: {
          filter: { _id: appt._id },
          update: {
            $set: {
              ageTier: priorityTag,
              prioritySortKey: priorityTag,
              ageAtSubmission: age,
            },
          },
        },
      });
    }

    // Ensure response sorting uses freshly computed strict triage tags.
    appt.ageTier = priorityTag;
    appt.prioritySortKey = priorityTag;
    appt.ageAtSubmission = age;
  }

  if (bulkOps.length) {
    await Appointment.bulkWrite(bulkOps, { ordered: true });
  }

  pending.sort((a, b) => {
    if (a.prioritySortKey !== b.prioritySortKey) return a.prioritySortKey - b.prioritySortKey;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return res.json({
    success: true,
    message: "Pending queue loaded successfully.",
    queueRole: scopeRole,
    appointments: pending.map(withQueueRole),
  });
});

/** The same role scoping as the pending queue, for the broader history list. */
exports.listAppointments = asyncHandler(async (req, res) => {
  const { status, missionScheduleId } = req.query;
  const { scopeRole, categoryKeys } = resolveQueueScope(req);
  const visibleKeys = applyCategoryFilter(categoryKeys, req.query?.categoryKey);

  const filter = { ...queueFilter(visibleKeys) };
  if (status) filter.status = status;
  if (missionScheduleId && mongoose.isValidObjectId(missionScheduleId)) {
    filter.missionSchedule = missionScheduleId;
  }

  const list = await Appointment.find(filter)
    .sort({ createdAt: -1 })
    .populate("resident", "fullname email dateOfBirth")
    .populate("missionSchedule", "date")
    .lean();

  return res.json({
    success: true,
    message: "Appointments loaded successfully.",
    queueRole: scopeRole,
    appointments: list.map(withQueueRole),
  });
});


/** Local midnight either side of today, for "is this today" comparisons. */
function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Everything the Appointment & Queue screen shows above the table, in one
 * round trip and scoped to the caller's own services.
 *
 * Counted in the database rather than by pulling every appointment to the
 * client and filtering there — the client would need the whole collection to
 * total five numbers, and would be counting records its own role is not
 * allowed to read.
 *
 * The figures here are only ones the schema can actually answer. There is no
 * queue subsystem in this system — no queue numbers, no check-in, no
 * serving/completed states — so this deliberately reports scheduling reality
 * (booked, waiting to be scheduled, ahead, turned down) rather than inventing
 * a "now serving" that nothing writes to.
 */
exports.getQueueOverview = asyncHandler(async (req, res) => {
  const { scopeRole, categoryKeys } = resolveQueueScope(req);
  const visibleKeys = applyCategoryFilter(categoryKeys, req.query?.categoryKey);
  const match = queueFilter(visibleKeys);

  const { start, end } = todayBounds();
  const booked = { $in: BOOKED_STATUSES };

  const [facets] = await Appointment.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        byCategory: [{ $group: { _id: "$consultationType", count: { $sum: 1 } } }],
        today: [
          { $match: { status: booked, slotStart: { $gte: start, $lt: end } } },
          { $count: "n" },
        ],
        upcoming: [
          { $match: { status: booked, slotStart: { $gte: end } } },
          { $count: "n" },
        ],
      },
    },
  ]);

  const statusCounts = Object.fromEntries(
    (facets?.byStatus ?? []).map((row) => [row._id, row.count])
  );
  const categoryCounts = Object.fromEntries(
    (facets?.byCategory ?? []).map((row) => [row._id, row.count])
  );

  // Today's schedule, ordered explicitly rather than trusting insertion order.
  const schedule = await Appointment.find({
    ...match,
    status: booked,
    slotStart: { $gte: start, $lt: end },
  })
    .sort({ slotStart: 1 })
    .populate("resident", "fullname profilePhoto")
    .select("consultationType status slotStart slotEnd resident")
    .lean();

  // Every service this role owns, including the ones sitting at zero — a
  // doctor with no consultations today should see that, not an absent row.
  // Services belonging to other roles never appear at all.
  const breakdown = CONSULTATION_CATEGORIES.filter(
    (category) => visibleKeys === null || visibleKeys.includes(category.key)
  ).map((category) => ({
    key: category.key,
    label: category.label,
    count: categoryCounts[category.key] ?? 0,
  }));

  return res.json({
    success: true,
    message: "Overview loaded successfully.",
    queueRole: scopeRole,
    stats: {
      today: facets?.today?.[0]?.n ?? 0,
      pending: statusCounts.pending ?? 0,
      upcoming: facets?.upcoming?.[0]?.n ?? 0,
      declined: statusCounts.declined ?? 0,
    },
    statusCounts: {
      pending: statusCounts.pending ?? 0,
      confirmed: statusCounts.confirmed ?? 0,
      rescheduled: statusCounts.rescheduled ?? 0,
      declined: statusCounts.declined ?? 0,
    },
    schedule: schedule.map(withQueueRole),
    breakdown,
  });
});

/** Category totals, scoped the same way the lists are. */
exports.getAnalyticsByCategory = asyncHandler(async (req, res) => {
  const { missionScheduleId } = req.query;
  const { categoryKeys } = resolveQueueScope(req);
  const visibleKeys = applyCategoryFilter(categoryKeys, req.query?.categoryKey);

  // Was unscoped: every staff role could read every category's totals, which
  // leaked the shape of other queues even though the lists themselves were
  // filtered.
  const match = { ...queueFilter(visibleKeys) };
  if (missionScheduleId && mongoose.isValidObjectId(missionScheduleId)) {
    match.missionSchedule = new mongoose.Types.ObjectId(missionScheduleId);
  }

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: {
          category: {
            $ifNull: ["$assignedCategoryKey", "$consultationType"],
          },
          status: "$status",
        },
        count: { $sum: 1 },
      },
    },
  ];

  const rows = await Appointment.aggregate(pipeline);
  return res.json({
    success: true,
    message: "Analytics loaded successfully.",
    analytics: rows,
  });
});

async function validateAndAssignSlot({
  appointment,
  mission,
  categoryKey,
  durationMinutes,
  slotStart,
  staffId,
  isReassign,
}) {
  const v = validateDurationForCategory(categoryKey, durationMinutes);
  if (!v.ok) {
    throw badRequest(v.message, ERROR_CODES.VALIDATION_ERROR);
  }
  const slotStartDate = new Date(slotStart);
  if (Number.isNaN(slotStartDate.getTime())) {
    throw badRequest("The selected appointment time is not a valid date.", ERROR_CODES.VALIDATION_ERROR);
  }
  const slotEndDate = new Date(slotStartDate.getTime() + v.durationMinutes * 60 * 1000);

  const windows = getMissionDayWindows(mission);
  if (!windows.length) {
    throw badRequest(
      "This mission schedule has no usable time windows. Please update the schedule first.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  if (!isIntervalInsideWindows(windows, slotStartDate, slotEndDate)) {
    throw badRequest(
      "The selected time falls outside the mission's morning and afternoon windows.",
      ERROR_CODES.SLOT_UNAVAILABLE
    );
  }

  const booked = await loadBookedForMission(mission._id, appointment._id);
  // Two staff members can assign the same slot concurrently, so an overlap is
  // a conflict with existing state rather than bad input from this caller.
  if (hasConflict(booked, slotStartDate, slotEndDate, String(appointment._id))) {
    throw conflict(
      "The selected appointment schedule is no longer available. Please choose another time.",
      ERROR_CODES.SLOT_UNAVAILABLE
    );
  }

  const hadSlot = Boolean(appointment.slotStart && appointment.missionSchedule);

  appointment.missionSchedule = mission._id;
  appointment.assignedCategoryKey = categoryKey;
  appointment.assignedDurationMinutes = v.durationMinutes;
  appointment.slotStart = slotStartDate;
  appointment.slotEnd = slotEndDate;
  appointment.assignedBy = staffId;
  appointment.assignedAt = new Date();

  if (isReassign && hadSlot) {
    appointment.status = "rescheduled";
  } else {
    appointment.status = "confirmed";
  }

  await appointment.save();
  return appointment;
}

exports.assignAppointment = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "appointment");
  const { missionScheduleId, categoryKey, durationMinutes, slotStart } = req.body;

  if (!missionScheduleId || !categoryKey || !slotStart) {
    throw badRequest(
      "A mission schedule, consultation category, and time slot are all required.",
      ERROR_CODES.MISSING_FIELDS
    );
  }
  assertValidObjectId(missionScheduleId, "mission schedule");

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
  }
  // Assigning an appointment that is already confirmed, rescheduled or
  // declined is an invalid state transition, not malformed input.
  if (appointment.status !== "pending") {
    throw conflict(
      `Only pending appointments can be scheduled. This appointment is already ${appointment.status}.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  const mission = await MissionSchedule.findById(missionScheduleId);
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  if (String(appointment.consultationType) !== String(categoryKey)) {
    throw badRequest(
      "The selected category does not match the patient's requested consultation type.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const missionCat = mission.categories?.find((c) => c.categoryKey === categoryKey);
  if (!missionCat) {
    throw badRequest(
      "This mission schedule has no slots for the selected consultation category.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  // Strict enforcement: only allow assigning the next triage appointment that is actually assignable.
  const next = await getFirstAssignablePendingAppointmentForMission(missionScheduleId);
  if (!next) {
    throw conflict("There is no assignable pending appointment for this mission schedule.", ERROR_CODES.CONFLICT);
  }
  if (String(next.appointmentId) !== String(appointment._id)) {
    throw conflict(
      "A higher-priority patient is next in the triage queue and must be scheduled first.",
      ERROR_CODES.TRIAGE_ORDER_VIOLATION
    );
  }

  await validateAndAssignSlot({
    appointment,
    mission,
    categoryKey,
    // Enforce the mission schedule's configured duration for this category.
    durationMinutes: missionCat.durationMinutes,
    slotStart,
    staffId: req.user.userId,
    isReassign: false,
  });

  const populated = await Appointment.findById(appointment._id)
    .populate("resident", "fullname email")
    .populate("assignedBy", "fullname")
    .populate("missionSchedule")
    .lean();

  const resident = populated.resident;
  const actorId = req.user.userId;
  const doctorLabel = populated.assignedBy?.fullname ?? null;
  const appointmentTypeLabel = formatConsultationTypeLabel(populated.consultationType);
  const details = {
    ...formatAppointmentDetails(populated.slotStart, doctorLabel, null),
    appointmentType: appointmentTypeLabel,
  };
  const timeLabel = formatSlotStartForNotification(populated.slotStart);

  const residentRecipientId = resident?._id ?? appointment.resident;

  // Notification creation is awaited for reliability; email sending is non-blocking.
  await createNotifications(
    [
      {
        recipient: residentRecipientId,
        appointment: populated._id,
        type: "appointment_confirmed",
        title: "Appointment confirmed",
        body: truncateNotificationBody(
          `Your ${appointmentTypeLabel} appointment is confirmed. Date: ${details.date}. Time: ${details.time}. Doctor: ${
            doctorLabel || "Medical mission team"
          }.`
        ),
        time: timeLabel,
        tone: "success",
      },
      {
        recipient: actorId,
        appointment: populated._id,
        type: "appointment_confirmed",
        title: "Appointment confirmed",
        body: truncateNotificationBody(
          `${resident?.fullname ? `${resident.fullname}'s` : "A patient's"} ${appointmentTypeLabel} appointment is confirmed.`
        ),
        time: timeLabel,
        tone: "success",
      },
    ],
    "appointments.assign"
  );

  if (resident?.email) {
    void sendAppointmentConfirmationEmail(resident.email, resident.fullname, details).catch((emailError) => {
      logger.warn("Confirmation email delivery failed", {
        errorName: emailError?.name,
        errorCode: emailError?.code,
      });
    });
  }

  // Fill any additional open slots using strict priority triage.
  // The appointment is already saved; a queue-refill failure must not turn a
  // successful assignment into an error response.
  try {
    await processMissionSchedulePriorityQueue(missionScheduleId, {
      staffId: req.user.userId,
    });
  } catch (queueError) {
    logger.warn("Priority queue reprocess after assign failed", {
      route: "appointments.assign",
      errorName: queueError?.name,
      errorMessage: queueError?.message,
    });
  }

  await createSystemLog({
    req,
    action: "APPOINTMENT_APPROVED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Medical staff approved and scheduled an appointment",
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: {
      missionScheduleId,
      categoryKey,
    },
  });

  return res.json({
    success: true,
    message: "Appointment confirmed and scheduled",
    appointment: populated,
  });
});

exports.reassignAppointment = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "appointment");
  const { missionScheduleId, categoryKey, durationMinutes, slotStart } = req.body;

  if (!missionScheduleId || !categoryKey || !slotStart) {
    throw badRequest(
      "A mission schedule, consultation category, and time slot are all required.",
      ERROR_CODES.MISSING_FIELDS
    );
  }
  assertValidObjectId(missionScheduleId, "mission schedule");

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
  }
  if (!BOOKED_STATUSES.includes(appointment.status)) {
    throw conflict(
      `Only confirmed or rescheduled appointments can be moved. This appointment is ${appointment.status}.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  const mission = await MissionSchedule.findById(missionScheduleId);
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }

  await validateAndAssignSlot({
    appointment,
    mission,
    categoryKey,
    durationMinutes,
    slotStart,
    staffId: req.user.userId,
    isReassign: true,
  });

  const populated = await Appointment.findById(appointment._id)
    .populate("resident", "fullname email")
    .populate("assignedBy", "fullname")
    .populate("missionSchedule")
    .lean();

  const resident = populated.resident;
  const actorId = req.user.userId;
  const doctorLabel = populated.assignedBy?.fullname ?? null;
  const appointmentTypeLabel = formatConsultationTypeLabel(populated.consultationType);
  const details = {
    ...formatAppointmentDetails(populated.slotStart, doctorLabel, null),
    appointmentType: appointmentTypeLabel,
  };
  const timeLabel = formatSlotStartForNotification(populated.slotStart);

  const residentRecipientId = resident?._id ?? appointment.resident;

  await createNotifications(
    [
      {
        recipient: residentRecipientId,
        appointment: populated._id,
        type: "appointment_rescheduled",
        title: "Appointment rescheduled",
        body: truncateNotificationBody(
          `Your ${appointmentTypeLabel} appointment has been rescheduled. Date: ${details.date}. Time: ${details.time}. Doctor: ${
            doctorLabel || "Medical mission team"
          }.`
        ),
        time: timeLabel,
        tone: "warning",
      },
      {
        recipient: actorId,
        appointment: populated._id,
        type: "appointment_rescheduled",
        title: "Appointment rescheduled",
        body: truncateNotificationBody(
          `${resident?.fullname ? `${resident.fullname}'s` : "A patient's"} ${appointmentTypeLabel} appointment is rescheduled.`
        ),
        time: timeLabel,
        tone: "warning",
      },
    ],
    "appointments.reassign"
  );

  if (resident?.email) {
    void sendAppointmentRescheduledEmail(resident.email, resident.fullname, details).catch((emailError) => {
      logger.warn("Reschedule email delivery failed", {
        errorName: emailError?.name,
        errorCode: emailError?.code,
      });
    });
  }

  // Fill any additional open slots using strict priority triage.
  try {
    await processMissionSchedulePriorityQueue(missionScheduleId, {
      staffId: req.user.userId,
    });
  } catch (queueError) {
    logger.warn("Priority queue reprocess after reassign failed", {
      route: "appointments.reassign",
      errorName: queueError?.name,
      errorMessage: queueError?.message,
    });
  }

  await createSystemLog({
    req,
    action: "APPOINTMENT_RESCHEDULED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Medical staff rescheduled an appointment",
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: {
      missionScheduleId,
      categoryKey,
    },
  });

  return res.json({
    success: true,
    message: "Appointment rescheduled",
    appointment: populated,
  });
});

exports.rejectAppointment = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "appointment");
  const { reason } = req.body;

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
  }

  const previousSlotStart = appointment.slotStart;
  const actorId = req.user.userId;
  const appointmentTypeLabel = formatConsultationTypeLabel(appointment.consultationType);

  const freedMissionScheduleId = appointment.missionSchedule;

  // Declining an already-declined appointment is a no-op, not a failure: the
  // desired end state already holds, so this stays a success rather than an error.
  if (appointment.status === "declined") {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "This appointment was already declined.",
      appointment,
    });
  }
  if (!["pending", "confirmed", "rescheduled"].includes(appointment.status)) {
    throw conflict(
      `An appointment that is ${appointment.status} can no longer be declined.`,
      ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  }

  appointment.status = "declined";
  appointment.declineReason = typeof reason === "string" ? reason.slice(0, 1000) : "";
  appointment.missionSchedule = null;
  appointment.slotStart = null;
  appointment.slotEnd = null;
  appointment.assignedCategoryKey = null;
  appointment.assignedDurationMinutes = null;
  await appointment.save();

  const timeLabel = formatSlotStartForNotification(previousSlotStart) || "Recent";

  // Create notifications after DB update (appointment.status is now "declined").
  await createNotifications(
    [
      {
        recipient: appointment.resident,
        appointment: appointment._id,
        type: "appointment_declined",
        title: "Appointment declined",
        body: truncateNotificationBody(
          `Your ${appointmentTypeLabel} appointment request was declined.${appointment.declineReason ? ` Reason: ${appointment.declineReason}` : ""}`
        ),
        time: timeLabel,
        tone: "info",
      },
      {
        recipient: actorId,
        appointment: appointment._id,
        type: "appointment_declined",
        title: "Appointment declined",
        body: truncateNotificationBody(`A ${appointmentTypeLabel} appointment request was declined by medical staff.`),
        time: timeLabel,
        tone: "info",
      },
    ],
    "appointments.reject"
  );

  const populated = await Appointment.findById(appointment._id).populate("resident", "fullname email").lean();

  // Optional: send declined email (include date/time if it existed before decline).
  if (populated?.resident?.email) {
    let doctorLabel = null;
    try {
      const doctorUserId = appointment.assignedBy ?? actorId;
      const doctorUser = await User.findById(doctorUserId).lean();
      doctorLabel = doctorUser?.fullname ?? null;
    } catch {
      doctorLabel = null;
    }

    const baseDetails = previousSlotStart
      ? formatAppointmentDetails(previousSlotStart, doctorLabel, null)
      : {
          date: "Date TBD",
          time: "Time TBD",
          worker: doctorLabel || "Medical mission team",
          location: "Barangay health mission site",
        };

    const declinedDetails = {
      ...baseDetails,
      appointmentType: appointmentTypeLabel,
      declineReason: appointment.declineReason,
    };

    void sendAppointmentDeclinedEmail(populated.resident.email, populated.resident.fullname, declinedDetails).catch(
      (emailError) => {
        logger.warn("Declined email delivery failed", {
          errorName: emailError?.name,
          errorCode: emailError?.code,
        });
      }
    );
  }

  if (freedMissionScheduleId) {
    try {
      await processMissionSchedulePriorityQueue(freedMissionScheduleId, {
        staffId: req.user.userId,
      });
    } catch (queueError) {
      logger.warn("Priority queue reprocess after decline failed", {
        route: "appointments.reject",
        errorName: queueError?.name,
        errorMessage: queueError?.message,
      });
    }
  }

  await createSystemLog({
    req,
    action: "APPOINTMENT_REJECTED",
    user: { _id: req.user.userId, role: req.user.role },
    role: req.user.role,
    description: "Medical staff rejected an appointment request",
    resource: "Appointment",
    resourceId: String(appointment._id),
    metadata: {
      reason: appointment.declineReason || "",
    },
  });

  return res.json({
    success: true,
    message: "Appointment declined.",
    appointment: populated,
  });
});

exports.suggestSlot = asyncHandler(async (req, res) => {
  const { missionScheduleId, categoryKey, durationMinutes, excludeAppointmentId } = req.query;
  if (!missionScheduleId || !categoryKey) {
    throw badRequest("A mission schedule and consultation category are required.", ERROR_CODES.MISSING_FIELDS);
  }
  assertValidObjectId(missionScheduleId, "mission schedule");

  const mission = await MissionSchedule.findById(missionScheduleId).lean();
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }
  const v = validateDurationForCategory(categoryKey, durationMinutes != null ? Number(durationMinutes) : undefined);
  if (!v.ok) {
    throw badRequest(v.message, ERROR_CODES.VALIDATION_ERROR);
  }
  const booked = await loadBookedForMission(mission._id, excludeAppointmentId || null);
  const next = suggestNextAvailableSlot(mission, booked, v.durationMinutes, excludeAppointmentId || null);
  return res.json({
    success: true,
    message: "Slot suggestion computed.",
    suggestedNextSlotStart: next,
    durationMinutes: v.durationMinutes,
  });
});

exports.STAFF_ROLES = STAFF_ROLES;
// Exported for the routing tests: the queue scope is a business rule, not an
// implementation detail, and it is worth asserting without a live database.
exports.resolveQueueScope = resolveQueueScope;
exports.applyCategoryFilter = applyCategoryFilter;
