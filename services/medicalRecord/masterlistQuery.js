"use strict";

// Builds the Mongo filter for the Medical Records Masterlist. Every filter is
// first narrowed to the services the signed-in role owns, so a BHW never sees
// a prenatal record however the request is shaped.

const User = require("../../models/User");
const { ALL_SOURCES, MEDICAL_RECORD_SOURCES } = require("../../config/medicalRecordSources");
const { idsMatchingSearch } = require("../masterList/medicalIdentityLookup");
const { parseCalendarDate, utcDayRange } = require("../../utils/calendarDate");
const { isValidObjectId } = require("../../utils/objectId");
const { ownedServiceKeys } = require("./serviceOwnership");
const { APPOINTMENT_FILTER, linkageFilter } = require("./linkageStatus");

const NAME_MATCH_CAP = 500;
const REFERENCE = /^(?:rec-)?([0-9a-f]{8})$/i;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const serviceScope = (user, requested) => {
  const owned = ownedServiceKeys(user);
  const keys = requested ? owned.filter((key) => key === requested) : owned;
  return { serviceType: { $in: keys } };
};

const sourceClause = (source) => {
  if (!ALL_SOURCES.includes(source)) return null;
  return source === MEDICAL_RECORD_SOURCES.APPOINTMENT ? APPOINTMENT_FILTER : { source };
};

const dateClause = (from, to) => {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);
  if (!start && !end) return null;
  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lt = utcDayRange(end).end;
  return { completedAt: range };
};

const residentAccountsMatching = async (search) => {
  const tokens = String(search).trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const users = await User.find({
    role: "resident",
    $and: tokens.map((token) => ({ fullname: new RegExp(escapeRegex(token), "i") })),
  })
    .select("_id")
    .limit(NAME_MATCH_CAP)
    .lean();
  return users.map((user) => user._id);
};

// Name, master list ID, full record ID or the short "REC-1A2B3C4D" reference.
const searchClause = async (search) => {
  const text = String(search ?? "").trim().slice(0, 80);
  if (!text) return null;

  const [masterIds, accountIds] = await Promise.all([idsMatchingSearch(text), residentAccountsMatching(text)]);
  const options = [{ masterResidentId: { $in: masterIds ?? [] } }, { resident: { $in: accountIds } }];
  if (isValidObjectId(text)) options.push({ _id: text });
  const reference = text.match(REFERENCE);
  if (reference) {
    options.push({
      $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: `${reference[1]}$`, options: "i" } },
    });
  }
  return { $or: options };
};

// Every record of one person: encoded under the master list ID, or completed
// through the account that holds it.
const residentClause = async (masterResidentId) => {
  if (typeof masterResidentId !== "string" || !masterResidentId.trim()) return null;
  const id = masterResidentId.trim();
  const account = await User.findOne({ masterResidentId: id }).select("_id").lean();
  return { $or: [{ masterResidentId: id }, ...(account ? [{ resident: account._id }] : [])] };
};

const buildMasterlistFilter = async (user, criteria = {}) => {
  const clauses = await Promise.all([
    searchClause(criteria.search),
    residentClause(criteria.masterResidentId),
    criteria.linkage ? linkageFilter(criteria.linkage) : null,
  ]);
  const all = [
    serviceScope(user, criteria.serviceType),
    sourceClause(criteria.source),
    dateClause(criteria.from, criteria.to),
    ...clauses,
  ].filter(Boolean);
  return all.length === 1 ? all[0] : { $and: all };
};

module.exports = { buildMasterlistFilter, serviceScope };
