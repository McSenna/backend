"use strict";

// Malformed requests must get a 4xx, never a 500, and seeding must never fall back
// to a password written in the source. Every person here is invented.

process.env.EMAIL_PROVIDER = "mock";
const assert = require("node:assert/strict");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const { seedAdmin } = require("../../services/seedAdmin");

const SEED_ENV = ["ADMIN_DEFAULT_PASSWORD", "ADMIN2_DEFAULT_PASSWORD", "MIDWIFE_DEFAULT_PASSWORD", "DOCTOR_DEFAULT_PASSWORD", "BHW_DEFAULT_PASSWORD"];
const PASSWORD = "SyntheticPass123!";

let seq = 0;
const make = (role) => {
  seq += 1;
  return User.create({ fullname: `Synthetic ${role} ${seq}`, email: `${role}.robust.${seq}@maslogcare.test`, password: PASSWORD, role, status: "active", verified: true, phone: "09170000000", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Purok 1, Test" });
};

const run = async () => {
  await h.setup();
  const admin = await make("admin");
  const asAdmin = h.asAdmin(admin);
  const login = (body) => h.request("/login", { method: "POST", body });

  for (const headers of [{ "Content-Type": "text/plain" }, { "Content-Type": "" }]) {
    const res = await h.request("/login", { method: "POST", headers });
    assert.equal(res.status, 400, `login without a JSON body: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, "MISSING_FIELDS");
    for (const path of ["/inventory/items", "/mission-schedule"]) {
      const staff = await h.request(path, { method: "POST", headers: { ...asAdmin, ...headers } });
      assert.ok(staff.status >= 400 && staff.status < 500, `${path} without a JSON body answered ${staff.status}`);
    }
  }

  for (const password of [123456, { a: 1 }, ["x"], true]) {
    const res = await login({ email: admin.email, password });
    assert.equal(res.status, 401, `login with password ${JSON.stringify(password)}: ${res.status}`);
    assert.equal(res.body.code, "INVALID_CREDENTIALS");
  }
  assert.equal((await login({ email: admin.email, password: PASSWORD })).status, 200, "the real password still signs in");

  for (const path of ["/users?search=%00", "/residents?search=%00", "/system-logs?search=%00", "/inventory/items?search=%00", "/admin/support/tickets?search=%00", "/admin/user-requests?search=%00", "/admin/master-residents?search=%00"]) {
    const res = await h.request(path, { headers: asAdmin });
    assert.equal(res.status, 400, `${path} answered ${res.status}`);
    assert.equal(res.body.code, "VALIDATION_ERROR");
  }
  assert.equal((await login({ email: "a\u0000@maslogcare.test", password: PASSWORD })).status, 400, "a null byte in a JSON value is refused");
  assert.equal((await h.request("/users?search=synthetic", { headers: asAdmin })).status, 200, "an ordinary search still works");

  const farPage = await h.request("/users?page=99999999999999999999", { headers: asAdmin });
  assert.equal(farPage.status, 200, `a huge page number answered ${farPage.status}`);

  const seeded = () => User.countDocuments({ email: { $in: ["maslog@admin.gov.ph", "maslog2@admin.gov.ph", "midwife@maslog.gov.ph", "doctor@maslog.gov.ph", "bhw@maslog.gov.ph"] } });
  for (const name of SEED_ENV) delete process.env[name];
  await seedAdmin();
  assert.equal(await seeded(), 0, "no staff account is created without a password from the environment");

  process.env.DOCTOR_DEFAULT_PASSWORD = "SeedSynthetic1!";
  await seedAdmin();
  assert.equal(await seeded(), 1, "only the account with a configured password is created");
  const doctor = await User.findOne({ email: "doctor@maslog.gov.ph" }).select("+password");
  assert.equal(await doctor.comparePassword("SeedSynthetic1!"), true);

  console.log("request robustness: all checks passed");
};

run()
  .then(async () => { await h.teardown(); process.exit(0); })
  .catch(async (error) => { console.error(error); await h.teardown().catch(() => {}); process.exit(1); });
