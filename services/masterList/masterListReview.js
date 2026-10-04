"use strict";

// Builds the admin-only master list section of a User Request. Records are
// read fresh by ID, so the admin compares against the list as it is today.

const MasterResident = require("../../models/MasterResident");
const { VERIFICATION_METHODS } = require("../../config/masterList");
const { calendarDate } = require("./normalize");

const VIEW_FIELDS =
  "masterResidentId firstName middleName lastName suffix dateOfBirth sex civilStatus barangay address role isActive";

const toAdminView = (record) => ({
  masterResidentId: record.masterResidentId,
  firstName: record.firstName,
  middleName: record.middleName || "",
  lastName: record.lastName,
  suffix: record.suffix || "",
  dateOfBirth: calendarDate(record.dateOfBirth),
  sex: record.sex,
  civilStatus: record.civilStatus,
  barangay: record.barangay,
  address: record.address,
  role: record.role || "resident",
  isActive: record.isActive !== false,
  missing: false,
});

// A record removed from the list after sign-up still shows by its ID.
const missingRecord = (masterResidentId) => ({ masterResidentId, missing: true });

const loadMasterListReview = async (verification, user) => {
  const check = verification?.masterListCheck ?? {};
  const candidateIds = check.candidateIds ?? [];
  const linkedId = user?.masterResidentId || null;
  const ids = [...new Set([...candidateIds, linkedId].filter(Boolean))];

  const records = ids.length
    ? await MasterResident.find({ masterResidentId: { $in: ids } }).select(VIEW_FIELDS).lean()
    : [];
  const byId = new Map(records.map((record) => [record.masterResidentId, toAdminView(record)]));
  const viewOf = (id) => byId.get(id) ?? missingRecord(id);

  return {
    checked: Boolean(check.outcome),
    outcome: check.outcome ?? null,
    reasons: check.reasons ?? [],
    checkedAt: check.checkedAt ?? null,
    candidates: candidateIds.map(viewOf),
    linkedRecord: linkedId ? viewOf(linkedId) : null,
    verificationMethod: verification?.verificationMethod ?? VERIFICATION_METHODS.ADMIN_REVIEW,
  };
};

module.exports = { loadMasterListReview, toAdminView };
