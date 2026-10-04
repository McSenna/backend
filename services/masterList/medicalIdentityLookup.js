"use strict";

// Read-only Barangay Master List lookups for medical record encoding. Staff
// get just enough to tell two residents apart (name, birth date, sex, purok,
// account yes/no), never the full official record. This module only runs find
// queries; master list writes stay in masterResidentAdmin.js.

const MasterResident = require("../../models/MasterResident");
const User = require("../../models/User");
const { calendarDate } = require("./normalize");
const { parseCalendarDate } = require("../../utils/calendarDate");

const IDENTITY_FIELDS = "masterResidentId firstName middleName lastName suffix dateOfBirth sex address isActive";
const PICKER_LIMIT = 10;
// A name search over records only needs the people it could mean; the cap
// stops a one-letter search from pulling in the whole list.
const NAME_MATCH_CAP = 500;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const fullNameOf = (record) =>
  [record.firstName, record.middleName, record.lastName, record.suffix].filter(Boolean).join(" ");

const PUROK = /\b(?:purok|prk\.?)\s*([\p{L}\p{N}-]+)/iu;

const purokOf = (address) => {
  const match = String(address ?? "").match(PUROK);
  return match ? `Purok ${match[1]}` : "";
};

const toIdentity = (record, linkedIds) => ({
  masterResidentId: record.masterResidentId,
  fullName: fullNameOf(record),
  dateOfBirth: calendarDate(record.dateOfBirth),
  sex: record.sex,
  purok: purokOf(record.address),
  isActive: record.isActive !== false,
  hasAccount: linkedIds.has(record.masterResidentId),
});

const linkedIdsAmong = async (ids) => {
  if (ids.length === 0) return new Set();
  const users = await User.find({ masterResidentId: { $in: ids } }).select("masterResidentId").lean();
  return new Set(users.map((user) => user.masterResidentId));
};

const tokensOf = (search) =>
  String(search ?? "").trim().slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 5);

// Each word must match a name part or the record ID; a YYYY-MM-DD word must
// match the birth date.
const identityFilter = (search) => {
  const clauses = tokensOf(search).map((token) => {
    const day = parseCalendarDate(token);
    if (day) return { dateOfBirth: day };
    const pattern = new RegExp(escapeRegex(token), "i");
    return { $or: ["firstName", "middleName", "lastName", "masterResidentId"].map((field) => ({ [field]: pattern })) };
  });
  return clauses.length > 0 ? { $and: clauses } : null;
};

const searchIdentities = async (search) => {
  const filter = identityFilter(search);
  if (!filter) return [];
  const records = await MasterResident.find({ ...filter, isActive: true })
    .select(IDENTITY_FIELDS)
    .sort({ lastName: 1, firstName: 1, _id: 1 })
    .limit(PICKER_LIMIT)
    .lean();
  const linked = await linkedIdsAmong(records.map((record) => record.masterResidentId));
  return records.map((record) => toIdentity(record, linked));
};

const identitiesByIds = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const [records, linked] = await Promise.all([
    MasterResident.find({ masterResidentId: { $in: unique } }).select(IDENTITY_FIELDS).lean(),
    linkedIdsAmong(unique),
  ]);
  return new Map(records.map((record) => [record.masterResidentId, toIdentity(record, linked)]));
};

const findIdentity = async (masterResidentId) => {
  const map = await identitiesByIds([masterResidentId]);
  return map.get(masterResidentId) ?? null;
};

const idsMatchingSearch = async (search) => {
  const filter = identityFilter(search);
  if (!filter) return null;
  const records = await MasterResident.find(filter).select("masterResidentId").limit(NAME_MATCH_CAP).lean();
  return records.map((record) => record.masterResidentId);
};

module.exports = { searchIdentities, identitiesByIds, findIdentity, idsMatchingSearch, fullNameOf };
