"use strict";

// Reads one search word as part of a birth date, the way the master list shows
// it ("Mar 15, 1990"). Birth dates are stored at UTC midnight, so every part is
// read in UTC. A word that is no date part adds nothing, and a date that cannot
// exist (02/30/1990) matches nobody instead of rolling over to another day.

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
// Three letters before a word counts as a month, so "ju" is not both June and July.
const MIN_MONTH_PREFIX = 3;

const isYear = (year) => year >= MIN_YEAR && year <= MAX_YEAR;
const isMonth = (month) => month >= 1 && month <= 12;

const utcDate = (year, month, day) => {
  if (!isYear(year) || !isMonth(month)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
};

const partIs = (operator, value) => ({
  $expr: { $eq: [{ [operator]: { date: "$dateOfBirth", timezone: "UTC" } }, value] },
});

const bornBetween = (from, to) => ({ dateOfBirth: { $gte: from, $lt: to } });

const yearClause = (year) =>
  isYear(year) ? [bornBetween(new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)))] : [];

const monthOfYearClause = (year, month) =>
  isYear(year) && isMonth(month)
    ? [bornBetween(new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 1)))]
    : [];

const exactDateClause = (year, month, day) => {
  const date = utcDate(year, month, day);
  return date ? [{ dateOfBirth: date }] : [];
};

const READERS = [
  // 1990
  [/^(\d{4})$/, ([year]) => yearClause(year)],
  // 15 or 03: the day of the month, as in "Mar 15, 1990"
  [/^(\d{1,2})$/, ([day]) => (day >= 1 && day <= 31 ? [partIs("$dayOfMonth", day)] : [])],
  // 1990-03-15 or 1990/03/15
  [/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/, ([year, month, day]) => exactDateClause(year, month, day)],
  // 03/15/1990 or 3-15-1990, month first as the app writes dates
  [/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/, ([month, day, year]) => exactDateClause(year, month, day)],
  // 1990-03
  [/^(\d{4})[-/](\d{1,2})$/, ([year, month]) => monthOfYearClause(year, month)],
  // 03/1990
  [/^(\d{1,2})[-/](\d{4})$/, ([month, year]) => monthOfYearClause(year, month)],
];

const monthClause = (word) => {
  if (!/^[a-z]+$/.test(word) || word.length < MIN_MONTH_PREFIX) return [];
  const month = MONTHS.findIndex((name) => name.startsWith(word)) + 1;
  return month ? [partIs("$month", month)] : [];
};

/** Mongo `$or` branches for one search word; empty when the word is no date part. */
const birthDateClauses = (token) => {
  // "Mar 15, 1990" splits into "15," and friends; the comma is not part of the date.
  const word = String(token ?? "").toLowerCase().replace(/[.,]+$/, "");
  for (const [pattern, read] of READERS) {
    const match = word.match(pattern);
    if (match) return read(match.slice(1).map(Number));
  }
  return monthClause(word);
};

module.exports = { birthDateClauses };
