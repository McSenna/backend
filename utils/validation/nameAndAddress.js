"use strict";

const { RESIDENCY } = require("../../config/residency");

const buildFullName = (firstName, middleName, surname, suffix) =>
  [firstName, middleName, surname, suffix]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");

const buildAddressLine = (address = {}) =>
  [
    address.houseNumberOrPurok,
    address.street,
    address.barangay ? `Barangay ${String(address.barangay).trim()}` : "",
    address.cityMunicipality,
    address.province,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");

const normalizeAddress = (address = {}) => ({
  houseNumberOrPurok: String(address.houseNumberOrPurok ?? "").trim(),
  street: String(address.street ?? "").trim(),
  barangay: RESIDENCY.barangay,
  cityMunicipality: String(address.cityMunicipality ?? "").trim() || RESIDENCY.cityMunicipality,
  province: String(address.province ?? "").trim() || RESIDENCY.province,
});

module.exports = { buildFullName, buildAddressLine, normalizeAddress };
