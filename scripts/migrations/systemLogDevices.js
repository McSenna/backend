"use strict";
// Adds device details to audit entries written before device logging. Run with --dry-run first.
//   node scripts/migrations/systemLogDevices.js --dry-run
// Entries inside the retention period get the server's reading of their stored
// User-Agent (source "server-ua", confidence low): the apps' own reports did not
// exist yet, so nothing better can be known. Older entries are left to the
// retention job. Safe to run again: an entry that has a device is skipped.
const SystemLog = require("../../models/SystemLog");
const Device = require("../../models/Device");
const { DEVICE_RETENTION_DAYS } = require("../../config/deviceRetention");
const { buildDeviceSnapshot, noDeviceSnapshot } = require("../../services/device/deviceSnapshot");

const BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const pendingFilter = (now) => ({
  device: { $exists: false },
  createdAt: { $gte: new Date(now.getTime() - DEVICE_RETENTION_DAYS * DAY_MS) },
});

const snapshotOf = (row) =>
  row.userAgent
    ? buildDeviceSnapshot({ claim: null, userAgent: row.userAgent, headers: {}, now: row.createdAt })
    : noDeviceSnapshot(row.createdAt);

const backfill = async (now) => {
  const cursor = SystemLog.collection.find(pendingFilter(now), { projection: { userAgent: 1, createdAt: 1 } });
  let batch = [];
  let written = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await SystemLog.collection.bulkWrite(batch, { ordered: false });
    written += batch.length;
    batch = [];
  };
  for await (const row of cursor) {
    // Guarded on device so a live write that landed meanwhile is never replaced.
    batch.push({ updateOne: { filter: { _id: row._id, device: { $exists: false } }, update: { $set: { device: snapshotOf(row) } } } });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return written;
};

const runMigration = async ({ dryRun = true, now = new Date() } = {}) => {
  if (dryRun) return { entriesToBackfill: await SystemLog.collection.countDocuments(pendingFilter(now)) };
  // Additive on purpose: syncIndexes would drop any index the schema does not list.
  await SystemLog.createIndexes();
  await Device.createIndexes();
  return { entriesBackfilled: await backfill(now) };
};

module.exports = { runMigration };

if (require.main === module) {
  require("dotenv").config();
  const dryRun = process.argv.includes("--dry-run");
  require("../../config/db")()
    .then(() => runMigration({ dryRun }))
    .then((counts) => process.stdout.write(`${dryRun ? "Dry run, nothing written" : "Migrated"}: ${JSON.stringify(counts)}\n`))
    .then(() => process.exit(0))
    .catch((error) => {
      process.stderr.write(`Migration failed: ${error?.message}\n`);
      process.exit(1);
    });
}
