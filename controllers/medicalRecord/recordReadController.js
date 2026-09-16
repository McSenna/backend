"use strict";

const Appointment = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { notFound, forbidden } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { getCategoryKeysForRole } = require("../../config/consultationCategories");
const { getCompletionForm } = require("../../config/medicalRecordFields");
const { createSystemLog } = require("../../services/systemLogService");
const { normalizeRole } = require("../../services/medicalRecord/serviceOwnership");

const APPOINTMENT_SELECT =
  "consultationType slotStart slotEnd status createdAt approvedAt completedAt missionSchedule";

exports.getMedicalRecord = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "medical record");

  const record = await MedicalRecord.findById(id)
    .populate("provider", "fullname role")
    .populate("resident", "fullname email dateOfBirth gender")
    .populate({ path: "appointment", select: APPOINTMENT_SELECT })
    .lean();

  if (!record) {
    throw notFound("Medical record not found.", ERROR_CODES.NOT_FOUND);
  }

  const role = normalizeRole(req.user);
  const userId = String(req.user.userId);
  const isOwner = String(record.resident?._id ?? record.resident) === userId;
  const isAuthor = String(record.provider?._id ?? record.provider) === userId;
  const ownsService = getCategoryKeysForRole(role).includes(record.serviceType);

  if (!isOwner && !isAuthor && !ownsService) {
    throw forbidden("You do not have permission to view this medical record.");
  }

  if (role === "resident") delete record.notes;

  void createSystemLog({
    req,
    action: "RECORD_VIEWED",
    user: { _id: req.user.userId, role },
    role,
    description: "Medical record viewed",
    resource: "MedicalRecord",
    resourceId: String(record._id),
    metadata: { serviceType: record.serviceType, viewedOwn: isOwner },
  });

  return res.json({
    success: true,
    message: "Medical record loaded successfully.",
    medicalRecord: record,
    form: getCompletionForm(record.serviceType),
  });
});

exports.getMyMedicalRecords = asyncHandler(async (req, res) => {
  const records = await MedicalRecord.find({ resident: req.user.userId })
    .sort({ completedAt: -1 })
    .populate("provider", "fullname role")
    .populate({
      path: "appointment",
      select: "consultationType slotStart slotEnd status createdAt approvedAt completedAt",
    })
    .select("-notes")
    .lean();

  return res.json({
    success: true,
    message: "Medical records loaded successfully.",
    medicalRecords: records,
  });
});

const buildCompletedFilter = (req, role) => {
  const ownedKeys = getCategoryKeysForRole(role);
  const requestedKey = String(req.query?.categoryKey || "").trim();
  const visibleKeys = requestedKey ? ownedKeys.filter((key) => key === requestedKey) : ownedKeys;

  const filter = { status: "completed" };

  if (role !== "admin") {
    filter.consultationType = { $in: visibleKeys };
  } else if (requestedKey) {
    filter.consultationType = requestedKey;
  }

  const { from, to } = req.query;
  if (from || to) {
    filter.completedAt = {};
    if (from && !Number.isNaN(new Date(from).getTime())) {
      filter.completedAt.$gte = new Date(from);
    }
    if (to && !Number.isNaN(new Date(to).getTime())) {
      filter.completedAt.$lte = new Date(to);
    }
    if (!Object.keys(filter.completedAt).length) delete filter.completedAt;
  }

  return filter;
};

exports.listCompletedAppointments = asyncHandler(async (req, res) => {
  const role = normalizeRole(req.user);

  const appointments = await Appointment.find(buildCompletedFilter(req, role))
    .sort({ completedAt: -1 })
    .populate("resident", "fullname email dateOfBirth gender phone")
    .populate("completedBy", "fullname role")
    .populate("assignedBy", "fullname role")
    .select(
      "consultationType status slotStart slotEnd createdAt approvedAt processingAt completedAt completedBy medicalRecord resident assignedBy"
    )
    .lean();

  return res.json({
    success: true,
    message: "Completed appointments loaded successfully.",
    queueRole: role,
    appointments,
  });
});
