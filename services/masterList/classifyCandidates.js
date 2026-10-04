"use strict";

// Barangay Master List matching rule
// ----------------------------------
// The caller has already limited candidates to ACTIVE records in the applicant's
// barangay. Each candidate is then compared field by field:
//
// 1. Core identity, all exact after strict normalization (case, Unicode form
//    and spacing only): first name, last name and date of birth.
// 2. Compatibility, checked only when the core identity agrees:
//    - middle name: equal, or both blank. One blank side is missing information.
//    - suffix: equal after alias folding (Jr./Junior, III/3rd), or both blank.
//    - sex: equal.
//    - address: every word of the applicant's house/purok and street appears in
//      the record's address (common abbreviations expanded). A blank
//      applicant address is missing information.
//
// Outcomes:
// - matched: exactly one record passes 1 and 2, and no other record shares the
//   date of birth with names that differ only by accents, spacing or
//   punctuation. This is the only outcome that may verify an account, and only
//   when policy allows it (config/masterList.js).
// - multiple_matches: more than one record could be this person.
// - conflict: one record passes 1 but a compatibility field disagrees.
// - partial_match: one record passes 1 but information is missing, or records
//   only match after loose normalization (accents and punctuation removed) or
//   with a different date of birth.
// - no_match: nothing comparable was found.
// A name alone, or a name plus an address, never produces "matched", and no
// outcome ever rejects an account: everything except "matched" goes to an admin.

const { MATCH_OUTCOMES, MATCH_REASONS, MAX_CANDIDATES } = require("../../config/masterList");
const { strictName, looseName, suffixKey, calendarDate, addressTokens } = require("./normalize");

const MISSING_INFO = new Set([MATCH_REASONS.MIDDLE_NAME_MISSING, MATCH_REASONS.ADDRESS_MISSING]);

const middleNameIssue = (applicant, record) => {
  const mine = strictName(applicant.middleName);
  const theirs = strictName(record.middleName);
  if (mine === theirs) return null;
  if (!mine || !theirs) return MATCH_REASONS.MIDDLE_NAME_MISSING;
  return MATCH_REASONS.MIDDLE_NAME_DIFFERS;
};

const addressIssue = (applicant, record) => {
  const mine = addressTokens(applicant.streetAddress);
  if (mine.length === 0) return MATCH_REASONS.ADDRESS_MISSING;
  const theirs = new Set(addressTokens(record.address));
  return mine.every((token) => theirs.has(token)) ? null : MATCH_REASONS.ADDRESS_DIFFERS;
};

const compatibilityIssues = (applicant, record) =>
  [
    middleNameIssue(applicant, record),
    suffixKey(applicant.suffix) === suffixKey(record.suffix) ? null : MATCH_REASONS.SUFFIX_DIFFERS,
    String(applicant.sex ?? "").toLowerCase() === String(record.sex ?? "").toLowerCase()
      ? null
      : MATCH_REASONS.SEX_DIFFERS,
    addressIssue(applicant, record),
  ].filter(Boolean);

const compareCandidate = (applicant, record) => {
  const sameDob = calendarDate(applicant.dateOfBirth) === calendarDate(record.dateOfBirth);
  const exactNames =
    strictName(applicant.firstName) === strictName(record.firstName) &&
    strictName(applicant.lastName) === strictName(record.lastName);
  const looseNames =
    looseName(applicant.firstName) === looseName(record.firstName) &&
    looseName(applicant.lastName) === looseName(record.lastName);

  if (sameDob && exactNames) {
    return { record, tier: "core", issues: compatibilityIssues(applicant, record) };
  }
  if (!looseNames) return null;

  const issues = [];
  if (!sameDob) issues.push(MATCH_REASONS.DOB_DIFFERS);
  if (!exactNames) issues.push(MATCH_REASONS.NAME_SPELLING_DIFFERS);
  return { record, tier: sameDob ? "near_same_dob" : "near", issues };
};

const idsOf = (comparisons) =>
  comparisons.slice(0, MAX_CANDIDATES).map((entry) => entry.record.masterResidentId);

const unique = (values) => [...new Set(values)];

const result = (outcome, comparisons = [], reasons = []) => ({
  outcome,
  reasons: unique(reasons),
  candidateIds: idsOf(comparisons),
});

const classifyCandidates = (applicant, records) => {
  const compared = records.map((record) => compareCandidate(applicant, record)).filter(Boolean);
  const cores = compared.filter((entry) => entry.tier === "core");
  const sameDayNear = compared.filter((entry) => entry.tier === "near_same_dob");
  const near = compared.filter((entry) => entry.tier !== "core");

  if (cores.length > 1 || (cores.length === 1 && sameDayNear.length > 0)) {
    return result(MATCH_OUTCOMES.MULTIPLE_MATCHES, [...cores, ...sameDayNear]);
  }

  if (cores.length === 1) {
    const { issues } = cores[0];
    if (issues.length === 0) return result(MATCH_OUTCOMES.MATCHED, cores);
    const onlyMissing = issues.every((issue) => MISSING_INFO.has(issue));
    return result(
      onlyMissing ? MATCH_OUTCOMES.PARTIAL_MATCH : MATCH_OUTCOMES.CONFLICT,
      cores,
      issues
    );
  }

  if (near.length > 0) {
    return result(
      MATCH_OUTCOMES.PARTIAL_MATCH,
      near,
      near.flatMap((entry) => entry.issues)
    );
  }

  return result(MATCH_OUTCOMES.NO_MATCH);
};

module.exports = { classifyCandidates };
