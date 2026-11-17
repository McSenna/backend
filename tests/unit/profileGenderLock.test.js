"use strict";

// Gender is recorded at registration and never changed by a profile edit.
const { EDITABLE_FIELDS, GENDER_LOCKED_MESSAGE, assertGenderUnchanged, buildProfileUpdate } = require("../../services/profile/profileUpdateBuilder");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const refusal = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
};

const current = { gender: "male", fullname: "Test Sample", firstName: "Test", surname: "Sample", suffix: "" };

check("gender is not an editable profile field", !EDITABLE_FIELDS.includes("gender"));

const changed = refusal(() => buildProfileUpdate({ gender: "female" }, current));
check("a different gender is refused", changed?.message === GENDER_LOCKED_MESSAGE, changed?.message);
check("the refusal is a 400 validation error", changed?.statusCode === 400 && changed?.code === "VALIDATION_ERROR", `${changed?.statusCode} ${changed?.code}`);

const cleared = refusal(() => assertGenderUnchanged({ gender: "" }, current));
check("clearing the gender is refused", cleared?.message === GENDER_LOCKED_MESSAGE);

const unset = refusal(() => assertGenderUnchanged({ gender: "female" }, { gender: "" }));
check("an account registered without one cannot add one later", unset?.message === GENDER_LOCKED_MESSAGE);

const same = refusal(() => buildProfileUpdate({ gender: " Male ", address: "Purok 2, Maslog" }, current));
check("sending back the stored value is accepted", same === null, same?.message);
check("the stored value is never written", !("gender" in buildProfileUpdate({ gender: "male", address: "Purok 2, Maslog" }, current)));

const untouched = buildProfileUpdate({ address: "Purok 3, Maslog" }, current);
check("other fields still save", untouched.address === "Purok 3, Maslog" && !("gender" in untouched));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
