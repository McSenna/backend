"use strict";

const { VALID_STATUSES } = require("../../models/user/userStatus");
const { SEGMENTS, statusGroupOf } = require("./accountLifecycle");
const { escapeRegex } = require("../../utils/escapeRegex");

const STATUS_FILTERS = ["requested", "approved", "active", "rejected", "deactivated"];

const ROLES = ["admin", "doctor", "midwife", "bhw", "resident"];

// Nulls sort lowest in MongoDB, so "newest" puts never-signed-in accounts last.
const SORTS = Object.freeze({
  last_login_desc: { lastLogin: -1, _id: -1 },
  last_login_asc: { lastLogin: 1, _id: 1 },
  name_asc: { fullname: 1, _id: 1 },
  joined_desc: { createdAt: -1, _id: -1 },
});

// Case-insensitive, so "ana" and "Ana" sort together under "Name, A to Z".
const NAME_COLLATION = { locale: "en", strength: 2 };


/**
 * Mirrors resolveUserStatus: older accounts have no `status`, only `verified`,
 * so the effective status is computed in the query to filter and count them.
 */
const effectiveStatusStage = {
  $addFields: {
    effectiveStatus: {
      $switch: {
        branches: [
          { case: { $in: ["$status", VALID_STATUSES] }, then: "$status" },
          {
            case: { $and: [{ $eq: ["$verified", true] }, { $ne: ["$role", "resident"] }] },
            then: "active",
          },
          { case: { $eq: ["$verified", true] }, then: "approved" },
        ],
        default: "pending",
      },
    },
  },
};

const pick = (value, allowed, fallback) => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(normalized) ? normalized : fallback;
};

// Past this, the skip value overflows what MongoDB accepts and the list answers 500.
const MAX_PAGE = 1_000_000;

const resolveListParams = (query = {}) => {
  const segment = pick(query.segment, Object.keys(SEGMENTS), "all");
  const status = pick(query.status, STATUS_FILTERS, "");
  const role = pick(query.role, ROLES, "");
  const sort = pick(query.sort, Object.keys(SORTS), "last_login_desc");
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(query.page, 10) || 1));
  const perPage = Math.min(100, Math.max(1, parseInt(query.per_page, 10) || 20));
  return { segment, status, role, sort, search, page, perPage };
};

const buildListMatch = ({ segment, status, role, search }) => {
  const statuses = status
    ? SEGMENTS[segment].filter((value) => statusGroupOf(value) === status)
    : SEGMENTS[segment];

  const match = { effectiveStatus: { $in: statuses } };
  if (role) match.role = role;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    match.$or = [{ fullname: pattern }, { email: pattern }, { address: pattern }];
  }
  return match;
};

module.exports = {
  SORTS,
  NAME_COLLATION,
  effectiveStatusStage,
  resolveListParams,
  buildListMatch,
};
