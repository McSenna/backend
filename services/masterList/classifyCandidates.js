"use strict";

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
