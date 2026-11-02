"use strict";

const User = require("../../models/User");
const { readPolicy } = require("../../services/residentWebAccess");
const { createSystemLog } = require("../../services/systemLogService");
const { serializeUserRow } = require("../../services/userDirectory/userPresenter");
const {
  SORTS,
  NAME_COLLATION,
  effectiveStatusStage,
  resolveListParams,
  buildListMatch,
} = require("../../services/userDirectory/userListQuery");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");

const EXPORT_ROW_CAP = 10000;
const HEADER = ["Name", "Email", "Role", "Account status", "Portal access", "Last login", "Joined"];

const ROLE_LABELS = { admin: "Admin", doctor: "Doctor", midwife: "Midwife", bhw: "BHW", resident: "Resident" };
const STATUS_LABELS = { requested: "Requested", approved: "Approved", active: "Active", rejected: "Rejected", deactivated: "Deactivated" };
const PORTAL_LABELS = {
  staff: "Web + mobile",
  global_blocked: "Blocked globally: Mobile only",
  exception_allowed: "Blocked globally: Individual access enabled",
  global_allowed: "Web + mobile: Follows global setting",
  individual_allowed: "Web + mobile: Individual access enabled",
  individual_blocked: "Web blocked: Individually blocked",
  ineligible: "No web access: Account not active",
  unavailable: "Web access unavailable",
};

// Quotes every cell, and defuses a leading = + - @ so a spreadsheet never runs it as a formula.
const cell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const manilaTime = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", dateStyle: "short", timeStyle: "short" });
const manilaDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", dateStyle: "short" });
const formatWith = (format, value) => (value ? format.format(new Date(value)) : "");

const toLine = (row) =>
  [
    row.fullname,
    row.email,
    ROLE_LABELS[row.role],
    STATUS_LABELS[row.statusGroup],
    PORTAL_LABELS[row.portalAccess.state],
    formatWith(manilaTime, row.lastLogin) || "Never",
    formatWith(manilaDate, row.createdAt),
  ]
    .map(cell)
    .join(",");

/** GET /users/export: the filtered view as CSV. Only the columns above ever leave the server. */
const exportUsers = asyncHandler(async (req, res) => {
  const params = resolveListParams(req.query);
  const accounts = await User.aggregate([
    effectiveStatusStage,
    { $match: buildListMatch(params) },
    { $sort: SORTS[params.sort] },
    { $limit: EXPORT_ROW_CAP + 1 },
    { $project: { fullname: 1, email: 1, role: 1, status: 1, verified: 1, lastLogin: 1, createdAt: 1, residentWebAccessOverride: 1, webAccessRevision: 1 } },
  ]).collation(NAME_COLLATION);

  const truncated = accounts.length > EXPORT_ROW_CAP;
  const policy = await readPolicy();
  const rows = accounts.slice(0, EXPORT_ROW_CAP).map((account) => serializeUserRow(account, policy));

  await createSystemLog({
    req,
    action: "USERS_EXPORTED",
    role: req.user.role,
    description: "Admin exported the user list",
    resource: "User",
    // Never the search text: it can hold a person's name.
    metadata: { segment: params.segment, role: params.role, status: params.status, rows: rows.length, searched: Boolean(params.search), truncated },
  });

  if (truncated) res.setHeader("X-Export-Truncated", "true");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send([HEADER.map(cell).join(","), ...rows.map(toLine)].join("\r\n"));
});

module.exports = { exportUsers };
