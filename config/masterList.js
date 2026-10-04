"use strict";

// Policy for the Barangay Master List check that runs during resident
// registration.
//
// Product decision (kape, 2026-10-02): a registration that matches exactly one
// active master list record cleanly is verified automatically and may sign in;
// anything else waits in Admin > User Requests. A match only shows that the
// resident is on the list, not who is registering (the other checks are an
// email code and an uploaded ID), so a barangay can switch automatic
// verification off with MASTER_LIST_AUTO_VERIFY=false.
const isMasterListAutoVerifyEnabled = () =>
  String(process.env.MASTER_LIST_AUTO_VERIFY ?? "").trim().toLowerCase() !== "false";

const MATCH_OUTCOMES = Object.freeze({
  MATCHED: "matched",
  NO_MATCH: "no_match",
  PARTIAL_MATCH: "partial_match",
  CONFLICT: "conflict",
  MULTIPLE_MATCHES: "multiple_matches",
  ALREADY_LINKED: "already_linked",
  INSUFFICIENT_DATA: "insufficient_data",
  UNAVAILABLE: "unavailable",
});

const MATCH_REASONS = Object.freeze({
  DOB_DIFFERS: "dob_differs",
  NAME_SPELLING_DIFFERS: "name_spelling_differs",
  MIDDLE_NAME_MISSING: "middle_name_missing",
  MIDDLE_NAME_DIFFERS: "middle_name_differs",
  SUFFIX_DIFFERS: "suffix_differs",
  SEX_DIFFERS: "sex_differs",
  ADDRESS_MISSING: "address_missing",
  ADDRESS_DIFFERS: "address_differs",
});

const VERIFICATION_METHODS = Object.freeze({
  MASTER_LIST: "master_list",
  ADMIN_REVIEW: "admin_review",
});

// Caps how many candidate records one check may return, so a common name
// cannot pull a large slice of the list into one review.
const MAX_CANDIDATES = 5;

module.exports = {
  isMasterListAutoVerifyEnabled,
  MATCH_OUTCOMES,
  MATCH_REASONS,
  VERIFICATION_METHODS,
  MAX_CANDIDATES,
};
