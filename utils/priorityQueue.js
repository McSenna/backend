"use strict";

function computeAgeYears(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function ageToTier(ageYears) {
  if (ageYears == null || ageYears < 0) return 4;
  if (ageYears < 2) return 0; 
  if (ageYears >= 60) return 1;
  if (ageYears <= 12) return 2;
  if (ageYears <= 17) return 3;
  return 4;
}

function computePrioritySortKey({ dateOfBirth, consultationTypeKey, isUrgent }) {
  const age = computeAgeYears(dateOfBirth);
  return ageToTier(age);
}

module.exports = {
  computeAgeYears,
  ageToTier,
  computePrioritySortKey,
};
