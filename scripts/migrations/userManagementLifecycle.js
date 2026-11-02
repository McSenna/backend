"use strict";
// Moves accounts to the User Management rules. Run with --dry-run first.
//   node scripts/migrations/userManagementLifecycle.js --dry-run
const mongoose = require("mongoose");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const ResidentVerification = require("../../models/ResidentVerification");

const NO_STATUS = { $or: [{ status: { $exists: false } }, { status: null }, { status: "" }] };
const NO_OVERRIDE_FIELD = { role: "resident", residentWebAccessOverride: { $exists: false } };

// webAccessRevision only moves when an admin saves a choice, so false with a
// revision is a deliberate "off", while false at revision 0 is the old default.
const OVERRIDE_RULES = [
  { name: "allow", value: "allow", match: { ...NO_OVERRIDE_FIELD, residentWebAccessEnabled: true } },
  { name: "block", value: "block", match: { ...NO_OVERRIDE_FIELD, residentWebAccessEnabled: { $ne: true }, webAccessRevision: { $gt: 0 } } },
  { name: "noOverride", value: null, match: { ...NO_OVERRIDE_FIELD, residentWebAccessEnabled: { $ne: true }, webAccessRevision: { $not: { $gt: 0 } } } },
];

const STATUS_BACKFILL = [
  { status: "active", match: { ...NO_STATUS, verified: true, role: { $ne: "resident" } } },
  { status: "approved", match: { ...NO_STATUS, verified: true, role: "resident" } },
  { status: "pending", match: { ...NO_STATUS, verified: { $ne: true } } },
];

const countPendingWithoutVerification = async () => {
  const [row] = await User.collection
    .aggregate([
      { $match: { $or: [{ status: "pending" }, { ...NO_STATUS, verified: { $ne: true } }] } },
      { $lookup: { from: ResidentVerification.collection.name, localField: "_id", foreignField: "user", as: "verifications" } },
      { $match: { verifications: { $size: 0 } } },
      { $count: "value" },
    ])
    .toArray();
  return row?.value ?? 0;
};

const countPlanned = async () => {
  const counts = {};
  for (const rule of OVERRIDE_RULES) counts[rule.name] = await User.collection.countDocuments(rule.match);
  counts.statusBackfilled = await User.collection.countDocuments(NO_STATUS);
  counts.promoted = await User.collection.countDocuments({
    lastLogin: { $ne: null },
    $or: [{ status: "approved" }, { ...NO_STATUS, verified: true, role: "resident" }],
  });
  counts.pendingWithoutVerification = await countPendingWithoutVerification();
  return counts;
};

const runMigration = async ({ dryRun = true } = {}) => {
  const policy = await Policy.findById("resident-web").lean();
  // Every untouched resident would gain web access the moment this ran.
  if (policy?.enabled === true) {
    throw new Error("Global resident web access is on. Turn it off, migrate, then turn it back on deliberately.");
  }
  const counts = await countPlanned();
  if (dryRun) return counts;

  const collection = User.collection;
  for (const { value, match } of OVERRIDE_RULES) {
    await collection.updateMany(match, { $set: { residentWebAccessOverride: value } });
  }
  for (const { status, match } of STATUS_BACKFILL) await collection.updateMany(match, { $set: { status } });
  await collection.updateMany({ status: "approved", lastLogin: { $ne: null } }, { $set: { status: "active" } });
  return counts;
};

module.exports = { runMigration };

if (require.main === module) {
  require("dotenv").config();
  const dryRun = process.argv.includes("--dry-run");
  require("../../config/db")()
    .then(() => runMigration({ dryRun }))
    .then((counts) => process.stdout.write(`${dryRun ? "Dry run, nothing written" : "Migrated"}: ${JSON.stringify(counts)}\n`))
    .catch((error) => {
      process.stderr.write(`User management migration failed: ${error.message}\n`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
