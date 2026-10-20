"use strict";

const { residentIdentityKey, IDENTITY_INDEX } = require("./residentIdentity");

// Stop all master-list writers during apply. Report counts only, never PII.
const migrateResidentIdentities = async (collection, { apply = false } = {}) => {
  const seen = new Set();
  const updates = [];
  let conflicts = 0;
  let invalid = 0;
  let scanned = 0;
  for await (const record of collection.find({})) {
    scanned += 1;
    if (!["firstName", "lastName", "sex", "civilStatus", "barangay", "address"].every(
      (field) => typeof record[field] === "string" && record[field].trim()
    ) || !(record.dateOfBirth instanceof Date) || Number.isNaN(record.dateOfBirth.getTime())) {
      invalid += 1;
      continue;
    }
    const identityKey = residentIdentityKey(record);
    if (seen.has(identityKey)) conflicts += 1;
    seen.add(identityKey);
    if (record.identityKey !== identityKey) updates.push({ updateOne: { filter: { _id: record._id }, update: { $set: { identityKey } } } });
  }
  const result = { scanned, conflicts, invalid, needsBackfill: updates.length, applied: false };
  if (!apply || conflicts || invalid) return result;
  for (let offset = 0; offset < updates.length; offset += 500) {
    await collection.bulkWrite(updates.slice(offset, offset + 500), { ordered: true });
  }
  await collection.createIndex({ identityKey: 1 }, { unique: true, name: IDENTITY_INDEX });
  return { ...result, applied: true };
};

module.exports = { migrateResidentIdentities };
