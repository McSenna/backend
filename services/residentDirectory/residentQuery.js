"use strict";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const RESIDENT_FIELDS = [
  "firstName",
  "middleName",
  "surname",
  "suffix",
  "fullname",
  "email",
  "phone",
  "address",
  "addressDetails",
  "profilePhoto",
  "status",
  "verified",
  "createdAt",
].join(" ");

const SORTS = {
  created_desc: { createdAt: -1, _id: -1 },
  created_asc: { createdAt: 1, _id: 1 },
  name_asc: { fullname: 1, _id: 1 },
  name_desc: { fullname: -1, _id: -1 },
};

const STATUS_FILTERS = ["active", "inactive", "pending", "suspended"];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const statusQuery = (status) => {
  if (status === "active") {
    return { $or: [{ status: "active" }, { status: { $exists: false }, verified: true }] };
  }
  if (status === "pending") {
    return { $or: [{ status: "pending" }, { status: { $exists: false }, verified: false }] };
  }
  return { status };
};

const searchQuery = (term) => {
  const pattern = new RegExp(escapeRegex(term), "i");
  const clauses = [
    { firstName: pattern },
    { middleName: pattern },
    { surname: pattern },
    { fullname: pattern },
    { email: pattern },
  ];

  const digits = term.replace(/\D/g, "");
  if (digits.length >= 3) clauses.push({ phone: new RegExp(escapeRegex(digits)) });

  const reference = term.trim().replace(/^res-/i, "");
  if (/^[0-9a-f]{2,24}$/i.test(reference)) {
    clauses.push({
      $expr: {
        $regexMatch: { input: { $toString: "$_id" }, regex: reference, options: "i" },
      },
    });
  }

  return { $or: clauses };
};

const buildResidentQuery = ({ status, search }) => {
  const conditions = [{ role: "resident" }];
  if (STATUS_FILTERS.includes(status)) conditions.push(statusQuery(status));
  if (search) conditions.push(searchQuery(search));

  return conditions.length > 1 ? { $and: conditions } : conditions[0];
};

const readListOptions = (query) => ({
  page: Math.max(1, Number.parseInt(query.page, 10) || 1),
  pageSize: Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE)
  ),
  sortKey: SORTS[query.sort] ? query.sort : "created_desc",
  status: String(query.status || "").toLowerCase(),
  search: String(query.search || "").trim().slice(0, 120),
});

module.exports = { RESIDENT_FIELDS, SORTS, buildResidentQuery, readListOptions };
