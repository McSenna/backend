"use strict";

// A resident's own medical history: completed appointments plus records
// encoded under the master list identity their account holds.

const MedicalRecord = require("../../models/MedicalRecord");
const asyncHandler = require("../../utils/asyncHandler");
const { forResident } = require("../../services/medicalRecord/residentRecordView");
const {
  residentRecordFilter,
  pagedResidentRecords,
} = require("../../services/medicalRecord/residentRecordQuery");

exports.getMyMedicalRecords = asyncHandler(async (req, res) => {
  const records = await MedicalRecord.find(await residentRecordFilter(req.user.userId))
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

// Paged history for the resident's records screen. Filters travel in the body
// so the search text stays out of URLs and request logs.
exports.searchMyMedicalRecords = asyncHandler(async (req, res) => {
  const { records, total, nextCursor } = await pagedResidentRecords(req.user.userId, req.body ?? {});
  return res.json({
    success: true,
    message: "Medical records loaded successfully.",
    medicalRecords: records.map(forResident),
    total,
    nextCursor,
  });
});
