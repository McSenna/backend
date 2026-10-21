"use strict";

// Browsers send Origin as scheme://host[:port] in lower case, with no path or
// trailing slash. Comparing raw strings made "https://maslogcare.com/" in
// CLIENT_ORIGINS refuse the real site with no error anywhere.
function normalizeOrigin(value) {
  try {
    const { origin, protocol } = new URL(String(value).trim());
    return protocol === "http:" || protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}

function parseOrigins(raw) {
  const valid = [];
  const invalid = [];
  for (const entry of String(raw || "").split(",").map((value) => value.trim()).filter(Boolean)) {
    const origin = normalizeOrigin(entry);
    if (origin) valid.push(origin);
    else invalid.push(entry);
  }
  return { valid, invalid };
}

function isLocalHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || !parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  return parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

module.exports = { normalizeOrigin, parseOrigins, isLocalHostname };
