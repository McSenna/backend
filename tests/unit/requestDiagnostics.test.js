"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const logger = require("../../utils/logger");
const { requestDiagnostics, timeDependency } = require("../../middleware/requestDiagnostics");
const { requestOperation } = require("../../utils/requestOperation");

test("diagnostics record one bounded safe completion even on finish followed by close", async () => {
  const original = logger.info;
  const entries = [];
  logger.info = (_message, entry) => entries.push(entry);
  const req = { headers: { "x-request-id": "unsafe\nheader", "x-request-attempt": "999" }, method: "GET",
    path: "/api/private/patient-id", originalUrl: "/api/private/patient-id?token=secret",
    route: { path: "/records/:id" } };
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableFinished: true, setHeader() {} });
  try {
    requestDiagnostics(req, res, () => {});
    assert.match(req.requestId, /^[0-9a-f-]{36}$/);
    await timeDependency(req, "accountLookup", async () => true);
    res.emit("finish"); res.emit("close");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].route, "/records/:id");
    assert.equal(entries[0].retryCount, 0);
    assert.equal(typeof entries[0].dependencyMs.accountLookup, "number");
    assert.doesNotMatch(JSON.stringify(entries), /patient-id|token=secret|unsafe/);
    assert.equal(requestOperation({ path: "/api/login", originalUrl: "/api/login?email=secret" }), "/login");
    assert.equal(requestOperation({ path: "/api/private/patient-id" }), "unmatched");
  } finally { logger.info = original; }
});

test("cancelled requests are categorized without inventing a response status", () => {
  const original = logger.info;
  let entry;
  logger.info = (_message, value) => { entry = value; };
  try {
    const res = Object.assign(new EventEmitter(), { locals: {}, writableFinished: false, setHeader() {} });
    requestDiagnostics({ headers: {}, method: "POST", path: "/api/login" }, res, () => {});
    res.emit("close");
    assert.equal(entry.category, "cancelled");
    assert.equal(entry.status, undefined);
  } finally { logger.info = original; }
});
