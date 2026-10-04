"use strict";

// Read-only lookup against the Barangay Master List. This module only ever
// runs find queries, so registration can never create, edit or delete a master
// record through it. The matching rule itself lives in classifyCandidates.js.

const MasterResident = require("../../models/MasterResident");
const User = require("../../models/User");
const logger = require("../../utils/logger");
const { MATCH_OUTCOMES } = require("../../config/masterList");
const { classifyCandidates } = require("./classifyCandidates");
const { looseName, barangayKey, calendarDate } = require("./normalize");

const CANDIDATE_FIELDS = "masterResidentId firstName middleName lastName suffix dateOfBirth sex address";

// A barangay has a few thousand residents, so one birthday or one full name
// stays far below this. The cap only guards against a malformed query.
const QUERY_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

const toApplicant = (profile, dateOfBirthInput) => ({
  firstName: profile.firstName,
  middleName: profile.middleName,
  lastName: profile.surname,
  suffix: profile.suffix,
  dateOfBirth: calendarDate(dateOfBirthInput || profile.dateOfBirth),
  sex: profile.gender,
  barangay: profile.addressDetails?.barangay,
  streetAddress: [profile.addressDetails?.houseNumberOrPurok, profile.addressDetails?.street]
    .filter(Boolean)
    .join(" "),
});

const hasCoreFields = (applicant) =>
  Boolean(
    looseName(applicant.firstName) &&
      looseName(applicant.lastName) &&
      applicant.dateOfBirth &&
      applicant.sex &&
      barangayKey(applicant.barangay)
  );

const findCandidates = (applicant) => {
  const dayStart = new Date(`${applicant.dateOfBirth}T00:00:00.000Z`);

  return MasterResident.find({
    "matchKeys.barangay": barangayKey(applicant.barangay),
    isActive: true,
    $or: [
      { dateOfBirth: { $gte: dayStart, $lt: new Date(dayStart.getTime() + DAY_MS) } },
      {
        "matchKeys.lastName": looseName(applicant.lastName),
        "matchKeys.firstName": looseName(applicant.firstName),
      },
    ],
  })
    .select(CANDIDATE_FIELDS)
    .limit(QUERY_LIMIT)
    .lean();
};

// One master record backs at most one account, so a record that already
// belongs to someone else is never auto-verified again.
const markIfAlreadyLinked = async (check) => {
  if (check.outcome !== MATCH_OUTCOMES.MATCHED) return check;
  const linked = await User.exists({ masterResidentId: check.candidateIds[0] });
  return linked ? { ...check, outcome: MATCH_OUTCOMES.ALREADY_LINKED } : check;
};

const runMasterListCheck = async ({ profile, dateOfBirthInput }) => {
  const checkedAt = new Date();
  const applicant = toApplicant(profile, dateOfBirthInput);

  if (!hasCoreFields(applicant)) {
    return { outcome: MATCH_OUTCOMES.INSUFFICIENT_DATA, reasons: [], candidateIds: [], checkedAt };
  }

  try {
    const records = await findCandidates(applicant);
    const check = await markIfAlreadyLinked(classifyCandidates(applicant, records));
    return { ...check, checkedAt };
  } catch (error) {
    // A lookup failure must not block sign-up; the admin reviews it instead.
    logger.error("Master list check failed", {
      errorName: error?.name,
      errorMessage: error?.message,
    });
    return { outcome: MATCH_OUTCOMES.UNAVAILABLE, reasons: [], candidateIds: [], checkedAt };
  }
};

module.exports = { runMasterListCheck };
