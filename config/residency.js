"use strict";

const RESIDENCY = Object.freeze({
  barangay: (process.env.RESIDENT_BARANGAY || "Maslog").trim(),
  cityMunicipality: (process.env.RESIDENT_CITY_MUNICIPALITY || "Legazpi City").trim(),
  province: (process.env.RESIDENT_PROVINCE || "Albay").trim(),
});

const SEX_OPTIONS = Object.freeze(["male", "female"]);

const CIVIL_STATUS_OPTIONS = Object.freeze([
  "single",
  "married",
  "widowed",
  "separated",
]);

module.exports = { RESIDENCY, SEX_OPTIONS, CIVIL_STATUS_OPTIONS };
