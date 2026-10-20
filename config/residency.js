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

const MASTER_RESIDENT_ROLES = Object.freeze(["resident", "bhw", "midwife"]);

const PUROK_OPTIONS = Object.freeze([
  "Purok 1, Centro",
  "Purok 2, Pangulo",
  "Purok 2, Pangulo 2",
  "Purok 3, Polique",
  "Purok 4, Gumihan",
  "Purok 5, East San Jose",
  "Purok 6, West San Jose",
  "Purok 7, West Pagbidayan",
  "Purok 8, East Pagbidayan",
  "Purok 9, Oraroy",
  "Purok 10, Macaradat",
]);

module.exports = { RESIDENCY, SEX_OPTIONS, CIVIL_STATUS_OPTIONS, MASTER_RESIDENT_ROLES, PUROK_OPTIONS };
