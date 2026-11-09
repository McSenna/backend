"use strict";

// Admins only view inventory; BHWs add items, receive stock and release it.
// Every refused write is checked against the database, not just the status code.
const jwt = require("jsonwebtoken");
const { createChecker, startHarness, createUser, finish } = require("./helpers/appointmentHarness");
const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const InventoryTransaction = require("../../models/InventoryTransaction");

const VIEW_ONLY = "You have view-only access to inventory.";
const TO = { destinationName: "Test ward", recipient: "Test recipient" };

const snapshot = async () => {
  const [items, batches, transactions] = await Promise.all([
    InventoryItem.find().sort({ _id: 1 }).lean(),
    InventoryBatch.find().sort({ _id: 1 }).lean(),
    InventoryTransaction.countDocuments(),
  ]);
  return JSON.stringify({ items, batches, transactions });
};

const run = async ({ request }, check) => {
  const admin = await createUser("admin");
  const bhw = await createUser("bhw");
  const doctor = await createUser("doctor");
  const resident = await createUser("resident");
  const call = (who, path, method = "GET", body) => request(path, { method, token: who.token, body });

  console.log("\nA BHW adds an item and stocks it");
  const created = await call(bhw, "/inventory/items", "POST", {
    name: "Test paracetamol", specification: "500 mg", category: "equipment", unit: "tablet", reorderLevel: 5,
    createdBy: String(admin.user._id), currentStock: 999,
  });
  const itemId = created.body.item?._id;
  check("a BHW may add an item (201)", created.status === 201 && Boolean(itemId), `${created.status} ${created.body.message}`);
  const stored = await InventoryItem.findById(itemId).lean();
  check("the new item starts at 0 whatever the body claims", stored?.currentStock === 0);
  check("the creator is the signed-in BHW, not the body's createdBy", String(stored?.createdBy) === String(bhw.user._id));

  const received = await call(bhw, `/inventory/items/${itemId}/stock-in`, "POST", { quantity: 10, batchNumber: "LOT-1" });
  check("a BHW may add stock (10)", received.status === 200 && received.body.item?.currentStock === 10, `${received.status} ${received.body.message}`);

  console.log("\nAn admin can look at everything");
  const list = await call(admin, "/inventory/items?limit=100");
  check("the admin sees the list", list.status === 200 && list.body.items?.some((item) => item._id === itemId));
  const perms = list.body.permissions ?? {};
  check("the list tells the admin they may view and see history", perms.view === true && perms.history === true);
  check("and that every write is closed", ["create", "edit", "stockIn", "stockOut", "deactivate"].every((key) => perms[key] === false), JSON.stringify(perms));
  const reads = await Promise.all([
    call(admin, `/inventory/items/${itemId}`),
    call(admin, `/inventory/items/${itemId}/history`),
    call(admin, "/inventory/summary"),
    call(admin, "/inventory/alerts"),
    call(admin, "/inventory/items?search=para&category=equipment&sort=name-asc"),
  ]);
  check("detail, history, summary, alerts and a filtered search all load", reads.every((res) => res.status === 200), reads.map((res) => res.status).join(","));
  check("the admin sees the BHW's stock-in in the history", reads[1].body.history?.some((entry) => entry.type === "STOCK_IN" && entry.quantity === 10));

  console.log("\nEvery admin write is refused and changes nothing");
  const attempts = [
    ["create an item", "/inventory/items", "POST", { name: "Admin item", category: "equipment", unit: "piece", reorderLevel: 1 }],
    ["edit an item", `/inventory/items/${itemId}`, "PATCH", { name: "Renamed by admin", reorderLevel: 99 }],
    ["deactivate an item", `/inventory/items/${itemId}`, "DELETE"],
    ["add stock", `/inventory/items/${itemId}/stock-in`, "POST", { quantity: 5, batchNumber: "LOT-ADMIN" }],
    ["release stock", `/inventory/items/${itemId}/stock-out`, "POST", { quantity: 1, reason: "Admin release" }],
    ["record an adjustment", `/inventory/items/${itemId}/stock-out`, "POST", { quantity: 1, reason: "Count fix", type: "ADJUSTMENT" }],
    ["write off expired stock", `/inventory/items/${itemId}/stock-out`, "POST", { quantity: 1, reason: "Expired", type: "EXPIRED" }],
  ];
  for (const [label, path, method, body] of attempts) {
    const before = await snapshot();
    const res = await call(admin, path, method, body);
    check(`admin may not ${label} (403, view-only message)`, res.status === 403 && res.body.message === VIEW_ONLY, `${res.status} ${res.body.message}`);
    check(`  and the database is unchanged`, (await snapshot()) === before);
  }

  console.log("\nA role or user claimed in the request does not count");
  const before = await snapshot();
  const spoofBody = await call(admin, `/inventory/items/${itemId}/stock-in`, "POST", {
    quantity: 5, batchNumber: "LOT-SPOOF", role: "bhw", userId: String(bhw.user._id), performedBy: String(bhw.user._id),
  });
  check("a body saying role bhw is still refused", spoofBody.status === 403);
  const forged = { token: jwt.sign({ userId: String(admin.user._id), role: "bhw", platform: "mobile" }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
  const spoofToken = await call(forged, `/inventory/items/${itemId}/stock-out`, "POST", { quantity: 1, reason: "Forged" });
  check("a token claiming bhw for an admin account is refused (role comes from the account)", spoofToken.status === 403, `${spoofToken.status}`);
  check("neither attempt changed anything", (await snapshot()) === before);

  console.log("\nA BHW releases stock within what is on hand");
  const released = await call(bhw, `/inventory/items/${itemId}/stock-out`, "POST", {
    ...TO, quantity: 4, reason: "Given at health center", performedBy: String(admin.user._id),
  });
  check("a BHW may release 4 of 10, leaving 6", released.status === 200 && released.body.item?.currentStock === 6, `${released.status} ${released.body.message}`);
  const outEntry = await InventoryTransaction.findOne({ item: itemId, type: "STOCK_OUT" }).lean();
  check("the history records item, quantity, reason and before/after stock",
    outEntry?.quantity === 4 && outEntry.reason === "Given at health center" && outEntry.previousStock === 10 && outEntry.newStock === 6);
  check("the responsible user is the BHW, not the body's performedBy", String(outEntry?.performedBy) === String(bhw.user._id) && outEntry.performedByRole === "bhw");
  check("and it carries a timestamp", outEntry?.createdAt instanceof Date);

  const held = await snapshot();
  for (const [label, body, status] of [
    ["more than is on hand (7 of 6)", { ...TO, quantity: 7, reason: "Too many" }, 409],
    ["zero", { ...TO, quantity: 0, reason: "Zero" }, 400],
    ["a negative quantity", { ...TO, quantity: -2, reason: "Negative" }, 400],
    ["a decimal", { ...TO, quantity: 1.5, reason: "Half" }, 400],
    ["text", { ...TO, quantity: "two", reason: "Text" }, 400],
    ["no reason", { ...TO, quantity: 1 }, 400],
  ]) {
    const res = await call(bhw, `/inventory/items/${itemId}/stock-out`, "POST", body);
    check(`releasing ${label} is refused (${status})`, res.status === status, `${res.status} ${res.body.message}`);
  }
  for (const quantity of [0, -3, 2.5]) {
    const res = await call(bhw, `/inventory/items/${itemId}/stock-in`, "POST", { quantity, batchNumber: "LOT-BAD" });
    check(`adding ${quantity} is refused (400)`, res.status === 400, `${res.status}`);
  }
  check("no refused BHW request changed the database", (await snapshot()) === held);

  console.log("\nConcurrent releases cannot overdraw");
  const race = await Promise.all([1, 2, 3].map(() => call(bhw, `/inventory/items/${itemId}/stock-out`, "POST", { ...TO, quantity: 3, reason: "Race" })));
  const wins = race.filter((res) => res.status === 200).length;
  const finalStock = (await InventoryItem.findById(itemId).lean()).currentStock;
  const lots = await InventoryBatch.find({ item: itemId }).lean();
  check("exactly two of three releases of 3 from 6 succeed", wins === 2, race.map((res) => res.status).join(","));
  check("the stock ends at 0, never below", finalStock === 0 && lots.every((lot) => lot.quantityRemaining >= 0), `${finalStock}`);
  const ledger = await InventoryTransaction.find({ item: itemId }).lean();
  const net = ledger.reduce((sum, entry) => sum + (entry.type === "STOCK_IN" ? entry.quantity : -entry.quantity), 0);
  check("the history adds up to the stock on hand", net === finalStock, `${net} vs ${finalStock}`);

  console.log("\nA BHW corrects item details");
  const edited = await call(bhw, `/inventory/items/${itemId}`, "PATCH", { name: "Test paracetamol tablets", reorderLevel: 30, updatedBy: String(admin.user._id) });
  const afterEdit = await InventoryItem.findById(itemId).lean();
  check("a BHW may edit item details (200)", edited.status === 200 && afterEdit.name === "Test paracetamol tablets" && afterEdit.reorderLevel === 30, `${edited.status} ${edited.body.message}`);
  check("the editor recorded is the BHW, not the body's updatedBy", String(afterEdit.updatedBy) === String(bhw.user._id));
  check("editing cannot set the stock directly (400)", (await call(bhw, `/inventory/items/${itemId}`, "PATCH", { currentStock: 500 })).status === 400);
  check("and the stock is still 0", (await InventoryItem.findById(itemId).lean()).currentStock === 0);

  console.log("\nA BHW deactivates an item, and its history stays");
  const ledgerBefore = await InventoryTransaction.countDocuments({ item: itemId });
  const retired = await call(bhw, `/inventory/items/${itemId}`, "DELETE");
  const afterRetire = await InventoryItem.findById(itemId).lean();
  check("a BHW may deactivate an item (200)", retired.status === 200 && afterRetire?.isActive === false, `${retired.status} ${retired.body.message}`);
  check("the record is kept, not deleted", Boolean(afterRetire));
  check("every history entry is kept", (await InventoryTransaction.countDocuments({ item: itemId })) === ledgerBefore && ledgerBefore >= 4);
  check("the admin can still read that history", (await call(admin, `/inventory/items/${itemId}/history`)).body.history?.length === ledgerBefore);
  check("a deactivated item takes no more stock (404)", (await call(bhw, `/inventory/items/${itemId}/stock-in`, "POST", { quantity: 1, batchNumber: "LOT-LATE" })).status === 404);
  check("and leaves the active list", !(await call(admin, "/inventory/items?limit=100")).body.items?.some((item) => item._id === itemId));

  console.log("\nThe other roles keep their existing access");
  check("a doctor may not add items", (await call(doctor, "/inventory/items", "POST", { name: "Doctor item", category: "equipment", unit: "piece", reorderLevel: 1 })).status === 403);
  check("a doctor may not edit or deactivate items", (await call(doctor, `/inventory/items/${itemId}`, "PATCH", { name: "Doctor rename" })).status === 403 && (await call(doctor, `/inventory/items/${itemId}`, "DELETE")).status === 403);
  check("a resident may not view inventory", (await call(resident, "/inventory/items")).status === 403);
};

(async () => {
  const { check, tally } = createChecker();
  const harness = await startHarness();
  try {
    await run(harness, check);
  } catch (error) {
    check("suite ran without an unexpected error", false, error?.stack);
  }
  await finish(harness, tally);
})();
