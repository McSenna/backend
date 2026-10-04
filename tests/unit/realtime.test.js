"use strict";

const { isBrowserHandshake } = require("../../realtime/socketAuth");
const { mergeChange, toChange } = require("../../realtime/changeFeed");
const { commitLagMs, slowBatchReport } = require("../../realtime/batchTiming");
const { splitChanges } = require("../../realtime/publishers/shared");
const { feedRoles } = require("../../realtime/publishers/announcements");
const { roomsForAccount, serviceOwnerRooms } = require("../../realtime/rooms");

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

const API_HOST = "api.maslogcare.test";

check("a handshake with no browser signals is not a browser", !isBrowserHandshake({ host: API_HOST }));
check(
  "React Native's Origin (the API's own host) is not a browser",
  !isBrowserHandshake({ host: API_HOST, origin: `https://${API_HOST}` })
);
check("Fetch Metadata headers mark a browser", isBrowserHandshake({ host: API_HOST, "sec-fetch-mode": "websocket" }));
check(
  "an Origin from another host marks a browser",
  isBrowserHandshake({ host: API_HOST, origin: "https://app.maslogcare.test" })
);

const created = { id: "a", action: "created", updatedKeys: [] };
const updated = { id: "a", action: "updated", updatedKeys: ["status"] };
const deleted = { id: "a", action: "deleted", updatedKeys: [] };
check("an insert then an update stays a create", mergeChange(created, updated).action === "created");
check("a delete wins over earlier changes", mergeChange(updated, deleted).action === "deleted");
check(
  "updated field names accumulate",
  mergeChange(updated, { ...updated, updatedKeys: ["role"] }).updatedKeys.join() === "status,role"
);
check(
  "a stream event becomes a change",
  toChange({ operationType: "replace", documentKey: { _id: "x" }, updatedKeys: null }).action === "updated"
);

check("commit lag is the time from the database commit to arrival", commitLagMs(new Date(1000), 1250) === 250);
check("a server that sends no commit time reports no lag", commitLagMs(undefined, 1250) === 0);
check("clock skew never makes the lag negative", commitLagMs(new Date(2000), 1500) === 0);
check("a batch emitted 180ms after commit is not reported", slowBatchReport({ lagMs: 30, receivedAt: 0 }, 50, 180) === null);
const slow = slowBatchReport({ lagMs: 900, receivedAt: 0 }, 50, 400);
check(
  "a batch over a second from commit to emit is reported by stage",
  slow?.lagMs === 900 && slow?.waitMs === 50 && slow?.publishMs === 350 && slow?.totalMs === 1300,
  JSON.stringify(slow)
);

const split = splitChanges([updated, { id: "b", action: "deleted", updatedKeys: [] }]);
check("live and deleted ids are separated", split.liveIds.join() === "a" && split.deletedIds.join() === "b");
check("nested field changes count as a change to the parent", splitChanges([{ ...updated, updatedKeys: ["status.x"] }]).changed("a", ["status"]));

check("drafts reach no feed", feedRoles({ isDraft: true, audience: "Everyone" }).length === 0);
check("ended announcements reach no feed", feedRoles({ audience: "Everyone", expiresAt: new Date(Date.now() - 1000) }).length === 0);
check("a Patients announcement reaches residents only", feedRoles({ audience: "Patients" }).join() === "resident");

check("staff join the staff room", roomsForAccount({ userId: "1", role: "bhw" }).includes("staff"));
check("residents do not join the staff room", !roomsForAccount({ userId: "1", role: "resident" }).includes("staff"));
check("a midwife service goes to admins and midwives", serviceOwnerRooms("prenatal").join() === "role:admin,role:midwife");

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
