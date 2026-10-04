"use strict";

const { VALID_STATUSES } = require("../../models/user/userStatus");

/**
 * The admin Users screen shows three account states. Pending and rejected
 * accounts belong to the sign-up request queue, not this list.
 */
const STATUS_GROUPS = Object.freeze({
  active: ["active"],
  approved: ["approved"],
  deactivated: ["inactive", "deactivated", "suspended"],
});

const LISTED_STATUSES = Object.freeze([
  ...STATUS_GROUPS.active,
  ...STATUS_GROUPS.approved,
  ...STATUS_GROUPS.deactivated,
]);

const TAB_STATUSES = Object.freeze({
  active: [...STATUS_GROUPS.active, ...STATUS_GROUPS.approved],
  deactivated: STATUS_GROUPS.deactivated,
  accounts: LISTED_STATUSES,
});

const ROLES = ["admin", "doctor", "midwife", "bhw", "resident"];

// Nulls sort lowest in MongoDB, so "newest" puts never-signed-in accounts last.
const SORTS = Object.freeze({
  last_login_desc: { lastLogin: -1, _id: -1 },
  last_login_asc: { lastLogin: 1, _id: 1 },
  name_asc: { fullname: 1, _id: 1 },
  joined_desc: { createdAt: -1, _id: -1 },
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const resolveListParams = (query = {}) => {
  const tab = pick(query.tab, Object.keys(TAB_STATUSES), "accounts");
  const status = pick(query.status, Object.keys(STATUS_GROUPS), "");
  const role = pick(query.role, ROLES, "");
  const sort = pick(query.sort, Object.keys(SORTS), "last_login_desc");
  const search = typeof query.query === "string" ? query.query.trim().slice(0, 100) : "";
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  return { tab, status, role, sort, search, page, pageSize };
};

const buildListMatch = ({ tab, status, role, search }) => {
  const tabStatuses = TAB_STATUSES[tab];
  const statuses = status
    ? STATUS_GROUPS[status].filter((value) => tabStatuses.includes(value))
    : tabStatuses;

  const match = { effectiveStatus: { $in: statuses } };
  if (role) match.role = role;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    match.$or = [{ fullname: pattern }, { email: pattern }, { address: pattern }];
  }
  return match;
};

module.exports = {
  STATUS_GROUPS,
  LISTED_STATUSES,
  SORTS,
  effectiveStatusStage,
  resolveListParams,
  buildListMatch,
};
