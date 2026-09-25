"use strict";

// Runs every *.test.js script in the given folder as its own process (each script exits non-zero on failure).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = path.resolve(__dirname, "..", process.argv[2] || "tests/unit");
const files = fs.readdirSync(dir).filter((name) => name.endsWith(".test.js")).sort();

const failed = [];
for (const name of files) {
  console.log(`\n▶ ${path.relative(process.cwd(), path.join(dir, name))}`);
  const result = spawnSync(process.execPath, [path.join(dir, name)], { stdio: "inherit" });
  if (result.status !== 0) failed.push(name);
}

console.log(`\n${files.length - failed.length}/${files.length} test files passed`);
if (failed.length > 0) {
  console.log(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
