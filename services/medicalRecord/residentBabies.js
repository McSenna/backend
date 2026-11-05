"use strict";

const User = require("../../models/User");
const Baby = require("../../models/Baby");
const MedicalRecord = require("../../models/MedicalRecord");
const { verifiedAccountFilter } = require("../immunization/access");

const verifiedMasterIdOf = async (userId) =>
  (await User.findOne({ _id: userId, ...verifiedAccountFilter({ $type: "string" }) }).select("masterResidentId").lean())
    ?.masterResidentId ?? null;

// A registered baby has no record until a first dose is saved, yet its mother
// can still read the schedule. Only a verified link reaches these, as with a
// baby's ledger. A deleted program record stays gone rather than coming back here.
const babiesWithoutRecords = async (userId) => {
  const masterResidentId = await verifiedMasterIdOf(userId);
  if (!masterResidentId) return [];
  const babies = await Baby.find({ motherMasterResidentId: masterResidentId })
    .select("name temporaryName dateOfBirth")
    .sort({ dateOfBirth: -1, _id: 1 })
    .lean();
  if (babies.length === 0) return [];
  const ids = babies.map((baby) => baby._id);
  const filed = await MedicalRecord.find({
    $or: [{ immunizationBabyId: { $in: ids } }, { deletedImmunizationBabyId: { $in: ids } }],
  })
    .withDeleted()
    .select("immunizationBabyId deletedImmunizationBabyId")
    .lean();
  const taken = new Set(filed.map((record) => String(record.immunizationBabyId ?? record.deletedImmunizationBabyId)));
  return babies
    .filter((baby) => !taken.has(String(baby._id)))
    .map((baby) => ({
      _id: String(baby._id),
      name: baby.name,
      temporaryName: Boolean(baby.temporaryName),
      dateOfBirth: baby.dateOfBirth,
    }));
};

module.exports = { babiesWithoutRecords };
