"use strict";
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { runInTransaction } = require("../../services/inventory/transactionRunner");
const original = mongoose.startSession;
const run = async () => {
  let writes = 0;
  mongoose.startSession = async () => { throw new Error("synthetic session failure"); };
  await assert.rejects(runInTransaction(async () => { writes += 1; }, { required: true }), error => error.statusCode === 503);
  assert.equal(writes, 0, "required transactions never fall back to unaudited writes");
  let ended = 0;
  mongoose.startSession = async () => ({
    withTransaction: async () => { throw Object.assign(new Error("Transaction numbers are only allowed on a replica set"), { code: 20 }); },
    endSession: async () => { ended += 1; },
  });
  await assert.rejects(runInTransaction(async () => { writes += 1; }, { required: true }), error => error.statusCode === 503);
  assert.equal(writes, 0);
  assert.equal(ended, 1);
  assert.equal(await runInTransaction(async session => session === null ? "existing fallback" : "transaction"), "existing fallback", "inventory defaults remain unchanged");
  const session = { withTransaction: async fn => fn(), endSession: async () => { ended += 1; } };
  mongoose.startSession = async () => session;
  assert.equal(await runInTransaction(async current => { assert.equal(current, session); return "committed"; }, { required: true }), "committed");
  console.log("Required transactions: no fallback, safe failure, cleanup and unchanged inventory defaults passed");
};
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { mongoose.startSession = original; });
