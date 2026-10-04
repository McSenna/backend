"use strict";

// One-time, repeatable upgrade for the medical records collection, run at
// startup. It only adds a default `source` to old records and swaps the old
// one-record-per-appointment index for a partial one; no record is changed
// otherwise and none is removed. Running it again does nothing.

const MedicalRecord = require("../../models/MedicalRecord");
const { APPOINTMENT_INDEX_NAME } = require("../../models/MedicalRecord");
const { MEDICAL_RECORD_SOURCES } = require("../../config/medicalRecordSources");

const LEGACY_APPOINTMENT_INDEX = "appointment_1";

const isMissingCollection = (error) => error?.codeName === "NamespaceNotFound" || error?.code === 26;

const listIndexNames = async () => {
  try {
    return (await MedicalRecord.collection.indexes()).map((index) => index.name);
  } catch (error) {
    if (isMissingCollection(error)) return [];
    throw error;
  }
};

const migrateMedicalRecordSources = async () => {
  // Let Mongoose finish its own index build first so the swap below does not race it.
  await MedicalRecord.init().catch(() => undefined);

  const { modifiedCount } = await MedicalRecord.updateMany(
    { source: { $exists: false } },
    { $set: { source: MEDICAL_RECORD_SOURCES.APPOINTMENT } }
  );

  const names = await listIndexNames();
  const droppedLegacyIndex = names.includes(LEGACY_APPOINTMENT_INDEX);
  if (droppedLegacyIndex) await MedicalRecord.collection.dropIndex(LEGACY_APPOINTMENT_INDEX);
  if (!names.includes(APPOINTMENT_INDEX_NAME)) await MedicalRecord.createIndexes();

  return { sourcesBackfilled: modifiedCount, droppedLegacyIndex };
};

module.exports = { migrateMedicalRecordSources, LEGACY_APPOINTMENT_INDEX };
