"use strict";
const assert = require("node:assert/strict");
const { once } = require("node:events");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const connectDB = require("../../config/db");
const { normalizeError } = require("../../middleware/errors/errorTranslators");

let replica;
async function run() {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1 }, instanceOpts: [{ args: ["--setParameter", "enableTestCommands=1"] }],
  });
  process.env.MONGO_URI = `${replica.getUri()}&maxPoolSize=1&retryReads=false`;
  await connectDB();
  const db = mongoose.connection.db;
  await db.collection("synthetic_timeout").insertOne({ value: "fixture" });
  const client = mongoose.connection.getClient();
  await db.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 },
    data: { failCommands: ["find"], blockConnection: true, blockTimeMS: 3500 } });
  const acquired = once(client, "connectionCheckedOut");
  const holding = db.collection("synthetic_timeout").findOne({});
  await acquired;
  const started = performance.now();
  await assert.rejects(db.collection("synthetic_timeout").findOne({}), (error) => {
    assert.equal(error.name, "MongoWaitQueueTimeoutError");
    assert.equal(normalizeError(error).statusCode, 503);
    return true;
  });
  const waitMs = Math.round(performance.now() - started);
  assert.ok(waitMs >= 1800 && waitMs < 3000, `pool wait took ${waitMs}ms`);
  await holding;
  await db.admin().command({ configureFailPoint: "failCommand", mode: { times: 1 },
    data: { failCommands: ["find"], blockConnection: true, blockTimeMS: 7000 } });
  const stalledAt = performance.now();
  await assert.rejects(db.collection("synthetic_timeout").findOne({}), (error) => {
    assert.equal(normalizeError(error).statusCode, 503);
    return true;
  });
  const socketMs = Math.round(performance.now() - stalledAt);
  assert.ok(socketMs >= 4500 && socketMs < 6500, `socket wait took ${socketMs}ms`);
  console.info(JSON.stringify({ scenario: "database_fault_limits", poolWaitMs: waitMs, socketWaitMs: socketMs }));
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});
