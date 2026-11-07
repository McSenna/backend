"use strict";
process.env.EMAIL_PROVIDER = "mock";
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const Policy = require("../../models/ResidentWebPolicy");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");

async function run() {
  await h.setup();
  await initializeResidentWebAccess();
  await Policy.updateOne({ _id: "resident-web" }, { $set: { enabled: true } });
  const user = await User.create({ fullname: "Synthetic Reliability", email: "reliability@example.test",
    password: "SyntheticOnly123", gender: "female", dateOfBirth: new Date("1990-01-01"),
    address: "Synthetic address", role: "resident", status: "approved", verified: true });
  let writes = 0;
  let reads = 0;
  const update = User.collection.updateOne;
  const find = Policy.collection.findOne;
  User.collection.updateOne = function (...args) { writes++; return update.apply(this, args); };
  Policy.collection.findOne = function (...args) { reads++; return find.apply(this, args); };
  try {
    const response = await h.request("/login", { method: "POST", headers: { Origin: "http://localhost:8081" },
      body: { email: user.email, password: "SyntheticOnly123" } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    console.info(JSON.stringify({ scenario: "login_round_trips", writes, policyReads: reads }));
    assert.equal(writes, 1, "lastLogin and first-sign-in promotion should use one atomic write");
    assert.equal(reads, 1, "the response should reuse the policy used to authorize login");
    const stored = await User.findById(user._id).lean();
    assert.equal(stored.status, "active");
    assert.ok(stored.lastLogin);
  } finally {
    User.collection.updateOne = update;
    Policy.collection.findOne = find;
  }
}
run().then(() => console.info("Login reliability regression passed")).catch((error) => {
  console.error(error); process.exitCode = 1;
}).finally(() => h.teardown());
