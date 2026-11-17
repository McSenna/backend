"use strict";
// PATCH /profile never changes gender: it is recorded at registration only.
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");
const { GENDER_LOCKED_MESSAGE } = require("../../services/profile/profileUpdateBuilder");

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  const doctor = await User.create({
    fullname: "Synthetic Doctor", email: "doctor.gender@maslogcare.test", password: "SyntheticPass123!", role: "doctor", status: "active",
    verified: true, phone: "09170000000", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Purok 1, Test",
  });
  const token = (await h.request("/login", { method: "POST", body: { email: doctor.email, password: "SyntheticPass123!", clientPlatform: "web" } })).body.token;
  assert.ok(token, "signed in");
  const patch = (body) => h.request("/profile", { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body });
  const stored = async () => (await User.findById(doctor._id).lean()).gender;

  const alone = await patch({ gender: "male" });
  assert.equal(alone.status, 400, JSON.stringify(alone.body));
  assert.equal(alone.body.message, GENDER_LOCKED_MESSAGE, "says why, not 'no editable fields'");
  assert.equal(await stored(), "female");

  const mixed = await patch({ gender: "other", address: "Purok 9, Test" });
  assert.equal(mixed.status, 400, "a change hidden in a wider save is refused too");
  assert.equal((await User.findById(doctor._id).lean()).address, "Purok 1, Test", "nothing in that save is written");

  const same = await patch({ gender: "Female", address: "Purok 2, Test" });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  assert.equal(same.body.user.gender, "female");
  assert.equal((await User.findById(doctor._id).lean()).address, "Purok 2, Test", "an unchanged gender does not block other fields");

  console.log("Profile gender lock assertions passed");
};

run().then(() => h.teardown()).catch(async (error) => { console.error(error); await h.teardown(); process.exitCode = 1; });
