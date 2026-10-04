"use strict";

// The source migration upgrades a database built before encoded records
// existed: old records get `source: "appointment"`, the old unique appointment
// index is swapped for the partial one, and a second run changes nothing.

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let passed = 0;
let failed = 0;
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : ` — ${detail}`}`);
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { autoIndex: false });
    const raw = mongoose.connection.collection("medicalrecords");
    await raw.createIndex({ appointment: 1 }, { unique: true, name: "appointment_1" });
    const legacy = [1, 2].map(() => ({
      resident: new mongoose.Types.ObjectId(),
      appointment: new mongoose.Types.ObjectId(),
      provider: new mongoose.Types.ObjectId(),
      providerRole: "doctor",
      serviceType: "consultation",
      assessment: "Legacy record",
      completedAt: new Date(),
    }));
    await raw.insertMany(legacy);

    const { migrateMedicalRecordSources } = require("../../services/medicalRecord/sourceMigration");
    const MedicalRecord = require("../../models/MedicalRecord");

    const first = await migrateMedicalRecordSources();
    check("both legacy records get a source", first.sourcesBackfilled === 2, JSON.stringify(first));
    check("the old index is dropped", first.droppedLegacyIndex === true);

    const names = (await raw.indexes()).map((index) => index.name);
    check("the partial index exists", names.includes(MedicalRecord.APPOINTMENT_INDEX_NAME), names.join());
    check("the old index is gone", !names.includes("appointment_1"));

    const second = await migrateMedicalRecordSources();
    check("a second run changes nothing", second.sourcesBackfilled === 0 && !second.droppedLegacyIndex, JSON.stringify(second));

    await MedicalRecord.create(
      [1, 2].map(() => ({
        source: "historical_masterlist",
        masterResidentId: "TEST-A",
        serviceType: "bp_checking",
        completedAt: new Date(),
      }))
    );
    check("two records without an appointment can coexist", (await MedicalRecord.countDocuments()) === 4);

    let blocked = false;
    try {
      await MedicalRecord.create({ ...legacy[0], _id: undefined, source: "appointment" });
    } catch (error) {
      blocked = error?.code === 11000;
    }
    check("one record per appointment is still enforced", blocked);
    check("legacy records are unchanged", (await raw.countDocuments({ assessment: "Legacy record" })) === 2);
  } catch (error) {
    check("suite ran without crashing", false, error?.stack);
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
