"use strict";

const { MASTER_RESIDENT_ROLES, CIVIL_STATUS_OPTIONS, PUROK_OPTIONS } = require("../../config/residency");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { birthDateClauses } = require("./birthDateSearch");

const STATUS_FILTERS = { active: { isActive: true }, inactive: { isActive: false }, all: {} };
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const searchFilter = (search) => {
  const tokens = String(search ?? "").trim().slice(0, 60).split(/\s+/).filter(Boolean).slice(0, 5);
  if (tokens.length === 0) return {};
  return {
    $and: tokens.map((token) => {
      const pattern = new RegExp(escapeRegex(token), "i");
      return {
        $or: [
          ...["firstName", "middleName", "lastName", "masterResidentId", "role"].map((field) => ({ [field]: pattern })),
          ...(pattern.test("resident") ? [{ role: { $in: [null, ""] } }] : []),
          ...birthDateClauses(token),
        ],
      };
    }),
  };
};

const purokFilter = (purok) => {
  if (purok === "all") return {};
  if (typeof purok !== "string" || !PUROK_OPTIONS.includes(purok)) {
    throw badRequest("Choose a purok from the list.", ERROR_CODES.VALIDATION_ERROR);
  }
  const number = purok.match(/^Purok (\d+),/)[1];
  const prefix = `Purok ${number},`;
  const ambiguous = PUROK_OPTIONS.filter((option) => option.startsWith(prefix)).length > 1;
  // The two Purok 2 areas need their named area. Other numbers can match legacy street addresses.
  const pattern = ambiguous
    ? `^\\s*${escapeRegex(purok)}(?:\\s*,|\\s*$)`
    : `^\\s*Purok\\s+${number}(?!\\d)(?:\\s|,|$)`;
  return { address: new RegExp(pattern, "i") };
};

const buildMasterResidentFilter = ({ search = "", status = "active", role = "all", civilStatus = "all", purok = "all" } = {}) => {
  if (typeof status !== "string" || !Object.hasOwn(STATUS_FILTERS, status)) {
    throw badRequest("Choose all, active, or inactive for the record status.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (typeof role !== "string" || !["all", ...MASTER_RESIDENT_ROLES].includes(role)) {
    throw badRequest("Choose all, resident, bhw, or midwife for the resident role.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (typeof civilStatus !== "string" || !["all", ...CIVIL_STATUS_OPTIONS].includes(civilStatus)) {
    throw badRequest("Choose a civil status from the list.", ERROR_CODES.VALIDATION_ERROR);
  }
  const civilFilter = civilStatus === "all" ? {} : { civilStatus };
  const roleFilter = role === "all" ? {} : {
    role: role === "resident" ? { $in: ["resident", null, ""] } : role,
  };
  return { ...STATUS_FILTERS[status], ...roleFilter, ...civilFilter, ...purokFilter(purok), ...searchFilter(search) };
};

const SORTS = {
  name_asc: { lastName: 1, firstName: 1, _id: 1 },
  name_desc: { lastName: -1, firstName: -1, _id: -1 },
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
};

const readMasterResidentSort = (sort = "name_asc") => {
  if (typeof sort !== "string" || !Object.hasOwn(SORTS, sort)) {
    throw badRequest("Choose a supported name or date-added sort order.", ERROR_CODES.VALIDATION_ERROR);
  }
  return SORTS[sort];
};

module.exports = { buildMasterResidentFilter, readMasterResidentSort };
