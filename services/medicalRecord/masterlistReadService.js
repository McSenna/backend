"use strict";

const MedicalRecord = require("../../models/MedicalRecord");
const { MEDICAL_RECORD_SOURCES } = require("../../config/medicalRecordSources");
const { identitiesByIds } = require("../masterList/medicalIdentityLookup");
const { assertValidObjectId } = require("../../utils/objectId");
const { forbidden, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { buildMasterlistFilter, serviceScope } = require("./masterlistQuery");
const { LINKAGE, linkageFor, linkageFilter } = require("./linkageStatus");
const { ownedServiceKeys } = require("./serviceOwnership");
const { toMasterlistRow, toMasterlistDetail } = require("./masterlistPresenter");

const ROW_FIELDS = "source serviceType completedAt providerName providerRole provider resident masterResidentId createdAt";
const RESIDENT_FIELDS = "fullname dateOfBirth gender";
const PERSON_FIELDS = "fullname role";

const pageOf = (criteria) => {
  const page = Math.max(1, parseInt(criteria.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(criteria.limit, 10) || 20));
  return { page, limit };
};

const contextFor = async (records) => {
  const ids = records.map((record) => record.masterResidentId).filter(Boolean);
  const [identities, linkage] = await Promise.all([identitiesByIds(ids), linkageFor(ids)]);
  return { identities, linkage };
};

// Per-service counts for one person's history, so staff see its shape at a glance.
// Aggregation skips Mongoose casting, so the filter is cast through a query first.
const serviceCountsFor = async (filter) => {
  const groups = await MedicalRecord.aggregate([
    { $match: MedicalRecord.find(filter).cast() },
    { $group: { _id: "$serviceType", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(groups.map((group) => [group._id, group.count]));
};

// The list's row shape. Realtime publishes records through these two helpers
// (realtime/publishers/medicalRecords.js), so pushed rows match listed rows.
const masterlistRowQuery = (filter) =>
  MedicalRecord.find(filter).select(ROW_FIELDS).populate("resident", RESIDENT_FIELDS).populate("provider", PERSON_FIELDS);

const presentMasterlistRows = async (records) => {
  const context = await contextFor(records);
  return records.map((record) => toMasterlistRow(record, context));
};

const listMasterlistRecords = async (user, criteria = {}) => {
  const { page, limit } = pageOf(criteria);
  const filter = await buildMasterlistFilter(user, criteria);

  const [records, total] = await Promise.all([
    masterlistRowQuery(filter)
      .sort({ completedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MedicalRecord.countDocuments(filter),
  ]);

  return {
    records: await presentMasterlistRows(records),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    ...(criteria.masterResidentId ? { serviceCounts: await serviceCountsFor(filter) } : {}),
  };
};

const countWith = async (scope, extra) => MedicalRecord.countDocuments(extra ? { $and: [scope, extra] } : scope);

// The cards and the list share filters, so each count matches the list it opens.
const masterlistSummary = async (user) => {
  const scope = serviceScope(user);
  const [linked, pending, unlinked] = await Promise.all(
    [LINKAGE.LINKED, LINKAGE.PENDING_REVIEW, LINKAGE.UNLINKED].map((status) => linkageFilter(status))
  );
  const [total, historical, linkedCount, pendingCount, unlinkedCount] = await Promise.all([
    countWith(scope),
    countWith(scope, { source: MEDICAL_RECORD_SOURCES.HISTORICAL_MASTERLIST }),
    countWith(scope, linked),
    countWith(scope, pending),
    countWith(scope, unlinked),
  ]);
  return {
    total,
    historical,
    linked: linkedCount,
    pendingReview: pendingCount,
    unlinked: unlinkedCount,
    services: ownedServiceKeys(user),
  };
};

const loadScopedRecord = async (user, id) => {
  const recordId = assertValidObjectId(id, "medical record");
  const record = await MedicalRecord.findById(recordId)
    .populate("resident", RESIDENT_FIELDS)
    .populate("provider", PERSON_FIELDS)
    .populate("createdBy", PERSON_FIELDS)
    .populate("updatedBy", PERSON_FIELDS)
    .populate("revisions.editedBy", PERSON_FIELDS)
    .lean();
  if (!record) throw notFound("Medical record not found.", ERROR_CODES.NOT_FOUND);
  if (!ownedServiceKeys(user).includes(record.serviceType)) {
    throw forbidden("You do not have permission to access this medical record.");
  }
  return record;
};

const getMasterlistRecord = async (user, id) => {
  const record = await loadScopedRecord(user, id);
  return toMasterlistDetail(record, await contextFor([record]), user);
};

module.exports = {
  listMasterlistRecords,
  masterlistSummary,
  getMasterlistRecord,
  loadScopedRecord,
  masterlistRowQuery,
  presentMasterlistRows,
};
