"use strict";

const PRIORITY_GROUPS = Object.freeze([
  Object.freeze({ group: 1, key: "infant", label: "Infants under 1 year", minYears: 0, maxYears: 0 }),
  Object.freeze({ group: 2, key: "senior", label: "Adults 60 and older", minYears: 60, maxYears: Infinity }),
  Object.freeze({ group: 3, key: "young_child", label: "Children 1 to 5", minYears: 1, maxYears: 5 }),
  Object.freeze({ group: 4, key: "child", label: "Children 6 to 12", minYears: 6, maxYears: 12 }),
  Object.freeze({ group: 5, key: "adolescent", label: "Adolescents 13 to 17", minYears: 13, maxYears: 17 }),
  Object.freeze({ group: 6, key: "adult", label: "Adults 18 to 59", minYears: 18, maxYears: 59 }),
]);

const UNKNOWN_PRIORITY_GROUP = 7;
const UNKNOWN_PRIORITY_LABEL = "Birth date needed";

const toDate = (value) => {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

function computeAgeYears(dateOfBirth, referenceDate = new Date()) {
  const dob = toDate(dateOfBirth);
  const at = toDate(referenceDate);
  if (!dob || !at || dob.getTime() > at.getTime()) return null;

  let age = at.getFullYear() - dob.getFullYear();
  const monthDiff = at.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dob.getDate())) age -= 1;
  return age < 0 ? null : age;
}

function ageToTier(ageYears) {
  if (ageYears == null || !Number.isInteger(ageYears) || ageYears < 0) return UNKNOWN_PRIORITY_GROUP;
  const match = PRIORITY_GROUPS.find((entry) => ageYears >= entry.minYears && ageYears <= entry.maxYears);
  return match ? match.group : UNKNOWN_PRIORITY_GROUP;
}

function priorityOf(dateOfBirth, referenceDate = new Date()) {
  const ageYears = computeAgeYears(dateOfBirth, referenceDate);
  return { ageYears, group: ageToTier(ageYears) };
}

function priorityGroupLabel(group) {
  if (group === UNKNOWN_PRIORITY_GROUP) return UNKNOWN_PRIORITY_LABEL;
  return PRIORITY_GROUPS.find((entry) => entry.group === group)?.label ?? UNKNOWN_PRIORITY_LABEL;
}

module.exports = {
  PRIORITY_GROUPS,
  UNKNOWN_PRIORITY_GROUP,
  UNKNOWN_PRIORITY_LABEL,
  computeAgeYears,
  ageToTier,
  priorityOf,
  priorityGroupLabel,
};
