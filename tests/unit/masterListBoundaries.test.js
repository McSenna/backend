"use strict";

// Static guard for the Master List / account boundary: only the admin master
// list modules may write master records, and master list code never writes
// accounts. A new write path fails here before it can ship.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP = new Set(["node_modules", "tests", "storage", "scripts"]);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const sourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });

const rel = (file) => path.relative(ROOT, file);
const files = sourceFiles(ROOT).map((file) => ({ file: rel(file), text: fs.readFileSync(file, "utf8") }));

const MASTER_WRITERS = new Set([
  "services/masterList/masterResidentAdmin.js",
  "services/masterList/masterResidentImport.js",
  "services/masterList/masterResidentPayload.js",
]);
const MASTER_READERS = new Set([
  "services/masterList/masterListMatcher.js",
  "services/masterList/masterLink.js",
  "services/masterList/masterListReview.js",
  "services/masterList/medicalIdentityLookup.js",
  "services/masterList/masterResidentRows.js",
]);

const WRITE_CALL = /\.(create|insertMany|save|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|replaceOne|deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete|bulkWrite)\s*\(/;
const MASTER_MODEL = /require\(["'][./]*models\/MasterResident["']\)/;

console.log("\nWho may touch MasterResident");

const importers = files.filter(({ text }) => MASTER_MODEL.test(text)).map(({ file }) => file);
const allowed = new Set([...MASTER_WRITERS, ...MASTER_READERS, "models/MasterResident.js"]);
const strangers = importers.filter((file) => !allowed.has(file));
check("only master list modules load the MasterResident model", strangers.length === 0, strangers.join(", "));

for (const file of MASTER_READERS) {
  const { text } = files.find((entry) => entry.file === file);
  check(`${file} only reads`, !WRITE_CALL.test(text));
}

const registrationAndProfile = files.filter(({ file }) =>
  /^(controllers\/(auth|profileController|userRequest|user)|services\/(auth|profile|userRequest|userDirectory))/.test(file)
);
check(
  "registration, profile and account code never load MasterResident",
  registrationAndProfile.every(({ text }) => !MASTER_MODEL.test(text)),
  registrationAndProfile.filter(({ text }) => MASTER_MODEL.test(text)).map(({ file }) => file).join(", ")
);

console.log("\nMaster list code never writes accounts");

const USER_WRITE = /\bUser\.(create|insertMany|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|replaceOne|deleteOne|deleteMany|findOneAndDelete|findByIdAndDelete|bulkWrite)\s*\(/;
for (const file of [...MASTER_WRITERS, ...MASTER_READERS]) {
  const { text } = files.find((entry) => entry.file === file);
  check(`${file} never writes the users collection`, !USER_WRITE.test(text) && !/user\.save\s*\(/.test(text));
}

const masterRoutes = files.find((entry) => entry.file === "routes/masterResidentRoutes.js").text;
const routeLines = masterRoutes.split("\n").filter((line) => /router\.(get|post|patch|put|delete)\(/.test(line));
check("every master list route is admin-only", routeLines.length > 0 && routeLines.every((line) => line.includes("...adminOnly")));
check("no master list route deletes records", !/router\.delete\(/.test(masterRoutes));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
