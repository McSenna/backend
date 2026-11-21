"use strict";

// Read-only "is this person already on the list?" check for the Add resident
// form. It warns; it never decides. Exact copies are still stopped by the
// identity index when the record is saved.

const MasterResident = require("../../models/MasterResident");
const { looseName } = require("./normalize");
const { parseCalendarDate } = require("../../utils/calendarDate");

const SHOWN = 3;
const PUROK = /^\s*(purok\s+\d+)/i;

// "Jay" and "Jayson" start the same, in either direction. Keys are letters only, so the pattern needs no escaping.
const firstNameStartsTheSame = (firstKey) => [
  { "matchKeys.firstName": new RegExp(`^${firstKey}`) },
  { "matchKeys.firstName": { $in: Array.from({ length: firstKey.length }, (_, end) => firstKey.slice(0, end + 1)) } },
];

/**
 * Same last name, and either a first name that starts the same or the same
 * birth date. Case, accents and punctuation are ignored. Deleted records are
 * never matched; inactive ones are, since the person may simply have moved back.
 */
const similarResidentFilter = ({ lastName, firstName, dateOfBirth } = {}) => {
  const lastKey = looseName(lastName);
  if (!lastKey) return null;
  const firstKey = looseName(firstName);
  const born = parseCalendarDate(dateOfBirth);
  const either = [...(firstKey ? firstNameStartsTheSame(firstKey) : []), ...(born ? [{ dateOfBirth: born }] : [])];
  if (either.length === 0) return null;
  return { deletedAt: null, "matchKeys.lastName": lastKey, $or: either };
};

const purokOf = (address) => {
  const match = PUROK.exec(String(address ?? ""));
  return match ? match[1].replace(/\s+/g, " ").replace(/^purok/i, "Purok") : "";
};

// Only what the warning shows: the name, the birth date and the purok.
const toSimilarRow = (record) => ({
  firstName: record.firstName,
  middleName: record.middleName ?? "",
  lastName: record.lastName,
  suffix: record.suffix ?? "",
  dateOfBirth: record.dateOfBirth.toISOString().slice(0, 10),
  purok: purokOf(record.address),
});

const findSimilarResidents = async (query) => {
  const filter = similarResidentFilter(query);
  if (!filter) return { total: 0, matches: [] };
  const [records, total] = await Promise.all([
    MasterResident.find(filter).sort({ lastName: 1, firstName: 1, _id: 1 }).limit(SHOWN).lean(),
    MasterResident.countDocuments(filter),
  ]);
  return { total, matches: records.map(toSimilarRow) };
};

const countSimilarResidents = async (query) => {
  const filter = similarResidentFilter(query);
  return filter ? MasterResident.countDocuments(filter) : 0;
};

module.exports = { findSimilarResidents, countSimilarResidents, similarResidentFilter, purokOf };
