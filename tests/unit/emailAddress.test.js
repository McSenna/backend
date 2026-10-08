"use strict";

// The same cases live in maslogCare/src/utils/__tests__/emailAddress.test.ts, so the
// app and the API accept and reject exactly the same addresses.
const { checkEmailAddress } = require("../../utils/validation/emailAddress");
const { isValidEmail } = require("../../utils/validation/basicValidators");
const { isValidEmail: resetAccepts } = require("../../services/passwordReset/resetPolicy");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ""}`);
  }
}

// Real addresses from any provider. None of these may be rejected.
const VALID = [
  "maria.santos@yahoo.com",
  "ana+clinic@outlook.ph",
  "o'neil@company.co",
  "JUAN.DelaCruz@DepEd.gov.ph",
  "user@sub.domain.museum",
  "user@xn--80ak6aa92e.com",
  "josé@correo.es",
  "  spaced@icloud.com  ",
  "a@b.co",
  "first_last-1@mail-server.org",
];

// Malformed input and the reason each one is reported with.
const INVALID = [
  ["", "empty"],
  ["   ", "empty"],
  ["a b@c.com", "spaces"],
  ["juan.example.com", "missingAt"],
  ["a@@b.com", "extraAt"],
  ["a@b@c.com", "extraAt"],
  ["@yahoo.com", "missingLocal"],
  [".a@b.com", "localDots"],
  ["a.@b.com", "localDots"],
  ["a..b@c.com", "localDots"],
  ["a(b)@c.com", "localChars"],
  ["a@", "domainFormat"],
  ["a@b", "domainFormat"],
  ["a@.com", "domainFormat"],
  ["a@b..com", "domainFormat"],
  ["a@b.com.", "domainFormat"],
  ["a@-b.com", "domainFormat"],
  ["a@b.c", "domainFormat"],
  ["a@b.123", "domainFormat"],
  ["juan@email,com", "domainFormat"],
  [`${"a".repeat(65)}@b.com`, "tooLong"],
  [`a@${"b".repeat(250)}.com`, "tooLong"],
];

for (const email of VALID) {
  const result = checkEmailAddress(email);
  check(`accepts ${JSON.stringify(email)}`, result.ok, result.ok ? "" : result.reason);
  check(`keeps the address as typed, trimmed: ${JSON.stringify(email)}`, result.ok && result.value === email.trim());
  check(`registration accepts ${JSON.stringify(email)}`, isValidEmail(email));
  check(`password reset accepts ${JSON.stringify(email)}`, resetAccepts(email.trim().toLowerCase()));
}

for (const [email, reason] of INVALID) {
  const result = checkEmailAddress(email);
  check(`rejects ${JSON.stringify(email)} as ${reason}`, !result.ok && result.reason === reason, result.ok ? "accepted" : result.reason);
  check(`registration rejects ${JSON.stringify(email)}`, !isValidEmail(email));
  check(`password reset rejects ${JSON.stringify(email)}`, !resetAccepts(email.trim().toLowerCase()));
}

check("does not merge Gmail dot or plus variants", checkEmailAddress("j.uan+x@gmail.com").value === "j.uan+x@gmail.com");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
