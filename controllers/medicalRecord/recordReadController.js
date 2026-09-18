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
const {
  describeAccess,
  forResident,
  redactForViewer,
} = require("../../services/medicalRecord/residentRecordView");

const APPOINTMENT_SELECT =
  "consultationType slotStart slotEnd status createdAt approvedAt completedAt missionSchedule";

const RECORD_POPULATE = [
  { path: "provider", select: "fullname role" },
  { path: "resident", select: "fullname email dateOfBirth gender" },
  { path: "appointment", select: APPOINTMENT_SELECT },
];

const findRecordByRecordOrAppointmentId = async (id) => {
  const byId = await MedicalRecord.findById(id).populate(RECORD_POPULATE).lean();
  if (byId) return byId;
  return MedicalRecord.findOne({ appointment: id }).populate(RECORD_POPULATE).lean();
};

exports.getMedicalRecord = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "medical record");

  const record = await findRecordByRecordOrAppointmentId(id);

  if (!record) {
    throw notFound("No medical details are available for this visit yet.", ERROR_CODES.NOT_FOUND);
  }

  const access = describeAccess(record, req.user);

  if (!access.isOwner && !access.isAuthor && !access.ownsService) {
    throw forbidden("You do not have permission to view this medical record.");
  }

  void createSystemLog({
    req,
    action: "RECORD_VIEWED",
    user: { _id: req.user.userId, role: access.role },
    role: access.role,
    description: "Medical record viewed",
    resource: "MedicalRecord",
    resourceId: String(record._id),
    metadata: { serviceType: record.serviceType, viewedOwn: access.isOwner },
  });

  return res.json({
    success: true,
    message: "Medical record loaded successfully.",
    medicalRecord: redactForViewer(record, access),
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
    .lean();

  return res.json({
    success: true,
    message: "Medical records loaded successfully.",
    medicalRecords: records.map(forResident),
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
