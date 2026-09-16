"use strict";

const { SEX_OPTIONS, CIVIL_STATUS_OPTIONS } = require("../../config/residency");
const { SUPPORTED_ID_TYPES } = require("../../config/idVerification");

const isValidIdType = (type) => {
  if (!type || typeof type !== "string") return false;
  const lower = type.trim().toLowerCase();
  return SUPPORTED_ID_TYPES.some(
    (entry) => entry.id.toLowerCase() === lower || entry.label.toLowerCase() === lower
  );
};

const isValidIdNumber = (num) => {
  if (!num || typeof num !== "string") return false;
  const clean = num.trim();
  return clean.length >= 3 && clean.length <= 50;
};

const PH_MOBILE_PATTERN = /^(?:\+?63|0)9\d{9}$/;

const stripSpacing = (value) => String(value ?? "").replace(/[\s()-]/g, "");

const isValidPhMobile = (value) => PH_MOBILE_PATTERN.test(stripSpacing(value));

const normalizePhMobile = (value) => {
  const compact = stripSpacing(value);
  if (!PH_MOBILE_PATTERN.test(compact)) return "";
  return `0${compact.slice(-10)}`;
};

const isValidNamePart = (value, { required }) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return !required;
  return trimmed.length <= 50 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u.test(trimmed);
};

const SUFFIX_PATTERN = /^[\p{L}][\p{L}\s.]*$/u;

const isValidSuffix = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return true;
  return trimmed.length <= 20 && SUFFIX_PATTERN.test(trimmed);
};

const isValidCivilStatus = (value) =>
  !value || CIVIL_STATUS_OPTIONS.includes(String(value).toLowerCase().trim());

const isValidSex = (value) => SEX_OPTIONS.includes(String(value ?? "").toLowerCase().trim());

module.exports = {
  isValidIdType,
  isValidIdNumber,
  isValidPhMobile,
  normalizePhMobile,
  isValidNamePart,
  isValidSuffix,
  isValidCivilStatus,
  isValidSex,
};
