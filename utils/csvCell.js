"use strict";

// Quotes every cell, and defuses a leading = + - @ so a spreadsheet never runs it as a formula.
const csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

module.exports = { csvCell };
