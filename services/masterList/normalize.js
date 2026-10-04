"use strict";

// Comparison-only normalizers for Barangay Master List matching. They build
// keys for comparing values and never rewrite a stored record. No fuzzy or
// similarity scoring lives here: two values either normalize to the same key
// or they do not.

const collapseSpaces = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Strict: Unicode NFC, case-folded, whitespace collapsed. Spelling, accents,
// hyphens and periods still count, so "Peña" and "Pena" differ here.
const strictName = (value) => collapseSpaces(String(value ?? "").normalize("NFC")).toLowerCase();

// Loose: accents stripped and every non-letter removed. Used only to find
// candidate records and to explain a near miss to the admin, never to verify.
const looseName = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");

const SUFFIX_ALIASES = Object.freeze({
  junior: "jr",
  senior: "sr",
  "2nd": "ii",
  "3rd": "iii",
  "4th": "iv",
  "5th": "v",
});

const suffixKey = (value) => {
  const compact = String(value ?? "").toLowerCase().replace(/[\s.]/g, "");
  return SUFFIX_ALIASES[compact] ?? compact;
};

const BARANGAY_PREFIX = /^(barangay|brgy)\s*/;

const barangayKey = (value) =>
  looseName(String(value ?? "").toLowerCase().replace(/\./g, " ").trim().replace(BARANGAY_PREFIX, ""));

// Calendar date as YYYY-MM-DD in UTC. A plain "1995-06-15" string is kept as
// typed, so a browser timezone can never shift the day.
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

const calendarDate = (value) => {
  if (typeof value === "string" && CALENDAR_DATE.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const ADDRESS_ABBREVIATIONS = Object.freeze({
  st: "street",
  str: "street",
  prk: "purok",
  pk: "purok",
  ave: "avenue",
  av: "avenue",
  rd: "road",
  blk: "block",
  lt: "lot",
  brgy: "barangay",
});

// Filler words that say nothing about where someone lives ("No. 12", "of").
const ADDRESS_FILLER = new Set(["no", "of", "the"]);

const addressTokens = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => ADDRESS_ABBREVIATIONS[token] ?? token)
    .filter((token) => !ADDRESS_FILLER.has(token));

module.exports = {
  strictName,
  looseName,
  suffixKey,
  barangayKey,
  calendarDate,
  addressTokens,
};
