"use strict";

// Shapes Medical Records Masterlist rows and details for staff. Rows carry
// only what the table shows; medical values load with the detail view.

const { getCategory, getCategoryKeysForRole } = require("../../config/consultationCategories");
const { getCompletionForm } = require("../../config/medicalRecordFields");
const { isAppointmentSource, MEDICAL_RECORD_SOURCES } = require("../../config/medicalRecordSources");
const { calendarDate } = require("../masterList/normalize");
const { linkageOfRecord } = require("./linkageStatus");
const { normalizeRole } = require("./serviceOwnership");

const idOf = (value) => (value ? String(value._id ?? value) : null);

const personOf = (person) =>
  person && typeof person === "object" ? { _id: idOf(person), fullname: person.fullname ?? "", role: person.role ?? "" } : null;

// An appointment record names its account holder; an encoded one its master
// list identity.
const residentOf = (record, identities) => {
  if (isAppointmentSource(record.source)) {
    const account = record.resident && typeof record.resident === "object" ? record.resident : null;
    return {
      masterResidentId: null,
      fullName: account?.fullname ?? "",
      dateOfBirth: account?.dateOfBirth ? calendarDate(account.dateOfBirth) : "",
      sex: account?.gender ?? "",
      purok: "",
      hasAccount: true,
    };
  }
  return (
    identities.get(record.masterResidentId) ?? {
      masterResidentId: record.masterResidentId,
      fullName: "",
      dateOfBirth: "",
      sex: "",
      purok: "",
      hasAccount: false,
      missing: true,
    }
  );
};

const providerLabel = (record) => record.provider?.fullname || record.providerName || "";

const toMasterlistRow = (record, { identities, linkage }) => ({
  _id: idOf(record),
  source: record.source || MEDICAL_RECORD_SOURCES.APPOINTMENT,
  serviceType: record.serviceType,
  serviceLabel: getCategory(record.serviceType)?.label ?? record.serviceType,
  visitDate: record.completedAt,
  providerName: providerLabel(record),
  providerRole: record.providerRole ?? record.provider?.role ?? null,
  resident: residentOf(record, identities),
  linkage: linkageOfRecord(record, linkage),
  createdAt: record.createdAt,
});

// Admins edit any encoded record; other staff only the ones they encoded, and
// only while their role still runs that service.
const canEdit = (record, user) => {
  if (isAppointmentSource(record.source)) return false;
  const role = normalizeRole(user);
  if (role === "admin") return true;
  return idOf(record.createdBy) === String(user?.userId) && getCategoryKeysForRole(role).includes(record.serviceType);
};

const toRevision = (revision) => ({
  editedBy: personOf(revision.editedBy),
  editedByRole: revision.editedByRole,
  editedAt: revision.editedAt,
  reason: revision.reason,
  changes: (revision.changes ?? []).map((change) => ({ field: change.field, previous: change.previous ?? null })),
});

const toMasterlistDetail = (record, context, user) => {
  const { requestKey, revisions, createdBy, updatedBy, ...rest } = record;
  return {
    ...toMasterlistRow(record, context),
    record: { ...rest, _id: idOf(record), source: record.source || MEDICAL_RECORD_SOURCES.APPOINTMENT },
    form: getCompletionForm(record.serviceType),
    audit: {
      createdBy: personOf(createdBy) ?? personOf(record.provider),
      createdByRole: record.createdByRole ?? record.providerRole ?? null,
      createdAt: record.createdAt,
      updatedBy: personOf(updatedBy),
      updatedByRole: record.updatedByRole ?? null,
      updatedAt: record.updatedAt,
      duplicateAcknowledged: Boolean(record.duplicateAcknowledged),
    },
    revisions: (revisions ?? []).map(toRevision).reverse(),
    editable: canEdit(record, user),
  };
};

module.exports = { toMasterlistRow, toMasterlistDetail, canEdit };
