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

// The directory shows four buckets, but residents are stored with the resident
// lifecycle statuses: an approved resident is "approved" (not "active") and the
// admin UI deactivates residents as "deactivated" (not "inactive"). Each bucket
// therefore covers every stored status that means the same thing.
const STATUS_BUCKETS = Object.freeze({
  active: ["active", "approved"],
  inactive: ["inactive", "deactivated"],
  pending: ["pending"],
  suspended: ["suspended"],
});

const STATUS_FILTERS = Object.keys(STATUS_BUCKETS);

const bucketOfStatus = (status) =>
  STATUS_FILTERS.find((bucket) => STATUS_BUCKETS[bucket].includes(status)) ?? null;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const statusQuery = (bucket) => {
  const stored = { status: { $in: STATUS_BUCKETS[bucket] } };
  if (bucket === "active") {
    return { $or: [stored, { status: { $exists: false }, verified: true }] };
  }
  if (bucket === "pending") {
    return { $or: [stored, { status: { $exists: false }, verified: false }] };
  }
  return stored;
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

module.exports = { RESIDENT_FIELDS, SORTS, bucketOfStatus, buildResidentQuery, readListOptions };
