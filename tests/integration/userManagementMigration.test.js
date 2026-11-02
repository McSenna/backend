"use strict";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const { runMigration } = require("../../scripts/migrations/userManagementLifecycle");

const base = (suffix, extra) => ({ _id: new mongoose.Types.ObjectId(), fullname: `Synthetic ${suffix}`, email: `${suffix}@maslogcare.test`, password: "x", role: "resident", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Test address", ...extra });

const run = async () => {
  await h.setup();
  const rows = {
    enabled: base("enabled", { status: "approved", verified: true, residentWebAccessEnabled: true, webAccessRevision: 1 }),
    turnedOff: base("turnedoff", { status: "approved", verified: true, residentWebAccessEnabled: false, webAccessRevision: 2 }),
    untouched: base("untouched", { status: "approved", verified: true, residentWebAccessEnabled: false, webAccessRevision: 0 }),
    missing: base("missing", { status: "approved", verified: true }),
    signedIn: base("signedin", { status: "approved", verified: true, lastLogin: new Date("2026-10-01") }),
    noStatusStaff: base("nostatusstaff", { role: "midwife", verified: true }),
    noStatusResident: base("nostatusresident", { verified: true }),
    noStatusPending: base("nostatuspending", { verified: false }),
    suspended: base("suspended", { status: "suspended", verified: true }),
  };
  await User.collection.insertMany(Object.values(rows));
  const read = (row) => User.collection.findOne({ _id: row._id });
  const snapshot = async () => JSON.stringify(await User.collection.find({}).sort({ _id: 1 }).toArray());

  const before = await snapshot();
  const dry = await runMigration({ dryRun: true });
  assert.equal(await snapshot(), before, "a dry run writes nothing");
  assert.equal(dry.allow, 1);
  assert.equal(dry.block, 1);
  assert.equal(dry.promoted, 1);
  assert.equal(dry.statusBackfilled, 3);
  assert.equal(dry.pendingWithoutVerification, 1, "a pending account with no ID on file is counted");

  await Policy.create({ _id: "resident-web", enabled: true, revision: 1 });
  await assert.rejects(runMigration({ dryRun: false }), /global resident web access is on/i);
  assert.equal(await snapshot(), before, "refuses to run while global is on");
  await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: false } });

  await runMigration({ dryRun: false });
  assert.equal((await read(rows.enabled)).residentWebAccessOverride, "allow");
  assert.equal((await read(rows.turnedOff)).residentWebAccessOverride, "block");
  assert.equal((await read(rows.untouched)).residentWebAccessOverride, null);
  assert.equal((await read(rows.missing)).residentWebAccessOverride, null);
  assert.equal((await read(rows.signedIn)).status, "active");
  assert.equal((await read(rows.untouched)).status, "approved");
  assert.equal((await read(rows.noStatusStaff)).status, "active");
  assert.equal((await read(rows.noStatusResident)).status, "approved");
  assert.equal((await read(rows.noStatusPending)).status, "pending");
  assert.equal((await read(rows.suspended)).status, "suspended", "older stored names stay as they are");
  assert.equal((await read(rows.enabled)).residentWebAccessEnabled, true, "the old field stays for rollback");

  await User.collection.updateOne({ _id: rows.untouched._id }, { $set: { residentWebAccessOverride: "block" } });
  const settled = await snapshot();
  await runMigration({ dryRun: false });
  assert.equal(await snapshot(), settled, "a second run changes nothing, including later admin choices");
  console.log("User management migration assertions passed");
};
run().then(() => h.teardown()).catch(async (error) => { console.error(error); await h.teardown(); process.exitCode = 1; });
