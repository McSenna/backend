"use strict";

// Raw collection access also catches missing roles that Mongoose defaults hide.
const UNASSIGNED = { role: { $in: [null, ""] } };

const migrateResidentRoles = async (collection, { apply = false } = {}) => {
  const needsBackfill = await collection.countDocuments(UNASSIGNED);
  if (!apply) return { needsBackfill, modified: 0, applied: false };
  const result = await collection.updateMany(UNASSIGNED, { $set: { role: "resident" } });
  return { needsBackfill, modified: result.modifiedCount, applied: true };
};

module.exports = { migrateResidentRoles };
