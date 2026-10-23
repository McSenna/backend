"use strict";

// The master list search box finds residents by birth date as the table shows
// it ("Mar 15, 1990"): by year, by month name, by day, or by a whole date.
// Every person here is invented.

const assert = require("node:assert/strict");
const User = require("../../models/User");
const MasterResident = require("../../models/MasterResident");
const { residentIdentityKey } = require("../../services/masterList/residentIdentity");
const harness = require("./helpers/masterListHarness");
const { request, asAdmin } = harness;

(async () => {
  try {
    await harness.setup();
    const admin = await User.create({
      fullname: "Birth Date Search Admin", email: "birthsearch@maslogcare.test", password: "TestPass123!",
      role: "admin", status: "active", verified: true, gender: "female",
      dateOfBirth: new Date("1980-01-01"), address: "Test Hall",
    });
    const fixtures = [
      ["BD-A", "Ana", "1990-03-15"],
      ["BD-B", "Ben", "1990-12-03"],
      ["BD-C", "Cora", "1985-03-03"],
      ["BD-D", "Mario", "2001-07-15"],
      ["BD-E", "Dan", "1990-03-05"],
      ["BD-F", "Fe", "2000-02-29"],
    ].map(([masterResidentId, firstName, birthDate]) => ({
      masterResidentId, firstName, lastName: "Sample", role: "resident", isActive: true,
      dateOfBirth: new Date(`${birthDate}T00:00:00.000Z`), sex: "female", civilStatus: "single",
      barangay: "Testville", address: "Purok 1, Centro", createdAt: new Date(),
    }));
    await MasterResident.collection.insertMany(fixtures.map((record) => ({ ...record, identityKey: residentIdentityKey(record) })));

    const headers = asAdmin(admin);
    const found = async (search) => {
      const response = await request(`/admin/master-residents?status=all&limit=50&search=${encodeURIComponent(search)}`, { headers });
      assert.equal(response.status, 200, `${search}: ${JSON.stringify(response.body)}`);
      return response.body.records.map((record) => record.masterResidentId).sort();
    };
    const expect = async (search, ids) => assert.deepEqual(await found(search), ids, `search "${search}"`);

    await expect("1990", ["BD-A", "BD-B", "BD-E"]);
    await expect("March", ["BD-A", "BD-C", "BD-E"]);
    await expect("mar", ["BD-A", "BD-C", "BD-D", "BD-E"]);
    await expect("Dec", ["BD-B"]);
    await expect("feb", ["BD-F"]);
    await expect("15", ["BD-A", "BD-D"]);
    await expect("3", ["BD-B", "BD-C"]);
    await expect("03", ["BD-B", "BD-C"]);
    await expect("29", ["BD-F"]);
    await expect("Mar 15, 1990", ["BD-A"]);
    await expect("march 1990", ["BD-A", "BD-E"]);
    await expect("03/15/1990", ["BD-A"]);
    await expect("3/15/1990", ["BD-A"]);
    await expect("1990-03-15", ["BD-A"]);
    await expect("2000-02-29", ["BD-F"]);
    await expect("1990-03", ["BD-A", "BD-E"]);
    await expect("3/1990", ["BD-A", "BD-E"]);
    await expect("Ana 1990", ["BD-A"]);
    await expect("Ben 1990", ["BD-B"]);

    // Dates that cannot exist, and numbers that are not a day or year, find nobody.
    for (const search of ["02/30/1990", "1990-13-01", "32", "0", "1990-02-29", "ju"]) {
      await expect(search, []);
    }

    // Name and record ID search still work as before.
    await expect("Cora", ["BD-C"]);
    await expect("BD-D", ["BD-D"]);

    console.log("PASS: birth date search by year, month name, day and full date, alongside name and record ID");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await harness.teardown();
  }
})();
