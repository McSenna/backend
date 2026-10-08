"use strict";

/**
 * The one email address rule for every auth entry point (registration code,
 * registration, password reset). It checks the shape of an address and never
 * its provider: any domain with a real-looking ending is accepted, Gmail or
 * not, and nothing is rewritten. Dots and "+tags" are kept, so two addresses
 * that only look alike are never treated as one person.
 *
 * Mirrored in maslogCare/src/utils/emailAddress.ts; both share one test list.
 */

const MAX_ADDRESS = 254;
const MAX_LOCAL = 64;
const MAX_LABEL = 63;
// Characters an unquoted local part may not contain (RFC 5322 specials).
const LOCAL_SPECIALS = /[(),:;<>[\]\\"]/u;
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;
const TOP_LEVEL = /^(?:[\p{L}]{2,}|xn--[a-z0-9-]+)$/iu;

const fail = (reason) => ({ ok: false, reason });

const checkDomain = (domain) => {
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => label.length <= MAX_LABEL && DOMAIN_LABEL.test(label))) return false;
  return TOP_LEVEL.test(labels[labels.length - 1]);
};

/**
 * Returns `{ ok: true, value }` with the address trimmed (case kept; callers
 * lower-case it where they store or look it up), or `{ ok: false, reason }`.
 */
const checkEmailAddress = (input) => {
  const value = String(input ?? "").trim();
  if (!value) return fail("empty");
  if (/\s/u.test(value)) return fail("spaces");

  const parts = value.split("@");
  if (parts.length === 1) return fail("missingAt");
  if (parts.length > 2) return fail("extraAt");

  const [local, domain] = parts;
  if (value.length > MAX_ADDRESS || local.length > MAX_LOCAL) return fail("tooLong");
  if (!local) return fail("missingLocal");
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return fail("localDots");
  if (LOCAL_SPECIALS.test(local)) return fail("localChars");
  if (!checkDomain(domain)) return fail("domainFormat");

  return { ok: true, value };
};

const isValidEmail = (input) => checkEmailAddress(input).ok;

module.exports = { checkEmailAddress, isValidEmail };
