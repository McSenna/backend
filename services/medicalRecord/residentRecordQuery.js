"use strict";

// Which records belong to a signed-in resident: their completed appointments,
// plus every record encoded under the master list identity their account
// holds. The identity is read fresh from the account on every request, so an
// admin unlink hides those records at once.

const User = require("../../models/User");
const MedicalRecord = require("../../models/MedicalRecord");
const { CONSULTATION_CATEGORIES } = require("../../config/consultationCategories");
const { ENCODABLE_SOURCES } = require("../../config/medicalRecordSources");
const { isValidObjectId } = require("../../utils/objectId");

const PAGE_SIZE = 30;
const RANGE_MONTHS = Object.freeze({ "6m": 6, "12m": 12 });

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const masterIdOf = async (userId) => {
  const user = await User.findById(userId).select("masterResidentId").lean();
  return user?.masterResidentId || null;
};

const residentRecordFilter = async (userId) => {
  const masterResidentId = await masterIdOf(userId);
  const own = [{ resident: userId }];
  if (masterResidentId) own.push({ masterResidentId, source: { $in: ENCODABLE_SOURCES } });
  return { $or: own };
};

const ownsRecord = async (userId, record) => {
  if (String(record.resident?._id ?? record.resident ?? "") === String(userId)) return true;
  if (!record.masterResidentId || !ENCODABLE_SOURCES.includes(record.source)) return false;
  return (await masterIdOf(userId)) === record.masterResidentId;
};

// The resident list's row shape (before forResident), shared with
// realtime/publishers/medicalRecords.js.
const residentRecordQuery = (filter) =>
  MedicalRecord.find(filter)
    .populate("provider", "fullname role")
    .populate({ path: "appointment", select: "consultationType slotStart slotEnd status createdAt approvedAt completedAt" });

/** Every resident account that may read this record: the visit's own account and the holder of its identity. */
const residentOwnersOf = async (record) => {
  const owners = new Set();
  if (record.resident) owners.add(String(record.resident?._id ?? record.resident));
  if (record.masterResidentId && ENCODABLE_SOURCES.includes(record.source)) {
    const holders = await User.find({ masterResidentId: record.masterResidentId }).select("_id").lean();
    for (const holder of holders) owners.add(String(holder._id));
  }
  return [...owners];
};

const monthsAgo = (months) => {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
};

// The search box matches a service name or the person who gave the care.
const queryClause = async (query) => {
  const text = String(query ?? "").trim().slice(0, 60);
  if (!text) return null;
  const pattern = new RegExp(escapeRegex(text), "i");
  const serviceKeys = CONSULTATION_CATEGORIES.filter((category) => pattern.test(category.label)).map(
    (category) => category.key
  );
  const providers = await User.find({ role: { $ne: "resident" }, fullname: pattern }).select("_id").limit(50).lean();
  return {
    $or: [
      { serviceType: { $in: serviceKeys } },
      { providerName: pattern },
      { provider: { $in: providers.map((provider) => provider._id) } },
    ],
  };
};

const cursorClause = (before) => {
  const at = new Date(before?.completedAt);
  if (!before || Number.isNaN(at.getTime()) || !isValidObjectId(before.id)) return null;
  return { $or: [{ completedAt: { $lt: at } }, { completedAt: at, _id: { $lt: before.id } }] };
};

const pagedResidentRecords = async (userId, criteria = {}) => {
  const service = typeof criteria.service === "string" && criteria.service !== "all" ? criteria.service : null;
  const months = RANGE_MONTHS[criteria.range];
  const clauses = [
    await residentRecordFilter(userId),
    service ? { serviceType: service } : null,
    months ? { completedAt: { $gte: monthsAgo(months) } } : null,
    await queryClause(criteria.query),
    cursorClause(criteria.before),
  ].filter(Boolean);
  const filter = { $and: clauses };

  const [rows, total] = await Promise.all([
    residentRecordQuery(filter).sort({ completedAt: -1, _id: -1 }).limit(PAGE_SIZE + 1).lean(),
    criteria.before ? null : MedicalRecord.countDocuments({ $and: clauses }),
  ]);

  const records = rows.slice(0, PAGE_SIZE);
  const last = records[records.length - 1];
  return {
    records,
    total,
    nextCursor: rows.length > PAGE_SIZE ? { completedAt: last.completedAt, id: String(last._id) } : null,
  };
};

module.exports = {
  residentRecordFilter,
  ownsRecord,
  pagedResidentRecords,
  residentRecordQuery,
  residentOwnersOf,
  PAGE_SIZE,
};
