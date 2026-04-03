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

/**
 * Strict priority tag (lower number = higher priority):
 * 0 → Age 0–1 (infants)
 * 1 → Age 60+ (elderly)
 * 2 → Age 2–12 (children)
 * 3 → Age 13–17 (teenagers)
 * 4 → Age 18–59 (adults; lowest)
 */
function ageToTier(ageYears) {
  if (ageYears == null || ageYears < 0) return 4;
  if (ageYears < 2) return 0; // 0–1
  if (ageYears >= 60) return 1;
  if (ageYears <= 12) return 2;
  if (ageYears <= 17) return 3;
  return 4;
}

/**
 * prioritySortKey must be exactly the strict numeric priority tag (0–4).
 */
function computePrioritySortKey({ dateOfBirth, consultationTypeKey, isUrgent }) {
  // Keep args for backward compatibility, but priority is based on AGE ONLY.
  const age = computeAgeYears(dateOfBirth);
  return ageToTier(age);
}

module.exports = {
  computeAgeYears,
  ageToTier,
  computePrioritySortKey,
};
