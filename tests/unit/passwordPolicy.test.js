"use strict";

const { PASSWORD_MAX_LENGTH } = require("../../config/passwordPolicy");
const { validatePassword, validatePasswordStrength } = require("../../utils/validation/basicValidators");
const { validatePasswordStrength: resetProblems } = require("../../services/passwordReset/resetPolicy");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const AT_LIMIT = "Abcdefg1!Abcdefg"; // 16 characters
const OVER_LIMIT = `${AT_LIMIT}x`;

check("limit is 16 characters", PASSWORD_MAX_LENGTH === 16);
check("fixture sits exactly at the limit", AT_LIMIT.length === PASSWORD_MAX_LENGTH);

check("registration accepts a 16-character password", validatePasswordStrength(AT_LIMIT).isValid);
check("registration rejects a 17-character password", !validatePasswordStrength(OVER_LIMIT).isValid);
check(
  "registration explains the limit",
  validatePasswordStrength(OVER_LIMIT).errors.includes("Password must not exceed 16 characters")
);

check("legacy registration accepts 16 characters", validatePassword(AT_LIMIT).isValid);
check("legacy registration rejects 17 characters", !validatePassword(OVER_LIMIT).isValid);

check("reset and change password accept 16 characters", resetProblems(AT_LIMIT).length === 0);
check(
  "reset and change password reject 17 characters",
  resetProblems(OVER_LIMIT).includes("Password must not exceed 16 characters."),
  JSON.stringify(resetProblems(OVER_LIMIT))
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
