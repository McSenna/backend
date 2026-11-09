"use strict";

// The movement ledger: every stock change is recorded once, atomically, and never edited.
const { createChecker, startHarness, createUser, finish } = require("./helpers/appointmentHarness");
const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");
const InventoryTransaction = require("../../models/InventoryTransaction");
const SystemLog = require("../../models/SystemLog");
const { runMigration } = require("../../scripts/migrations/inventoryMovementLedger");

const DAY_MS = 24 * 60 * 60 * 1000;
const TO = { destinationName: "Zone 3 outreach", destinationDepartment: "Maternal unit", recipient: "Test Receiver", recipientDesignation: "Nurse" };

const run = async ({ request }, check) => {
  const admin = await createUser("admin");
  const bhw = await createUser("bhw");
  const doctor = await createUser("doctor");
  const midwife = await createUser("midwife");
  const resident = await createUser("resident");
  const call = (who, path, method = "GET", body) => request(path, { method, token: who.token, body });
  const newItem = async (name) => (await call(bhw, "/inventory/items", "POST", { name, category: "equipment", unit: "piece", reorderLevel: 1 })).body.item._id;
  const stockIn = (id, body) => call(bhw, `/inventory/items/${id}/stock-in`, "POST", body);
  const stockOut = (id, body) => call(bhw, `/inventory/items/${id}/stock-out`, "POST", { ...TO, reason: "Outreach", ...body });
  const stockOf = async (id) => (await InventoryItem.findById(id).lean()).currentStock;
  const rowsOf = (id) => InventoryTransaction.find({ item: id }).sort({ createdAt: 1, _id: 1 }).lean();
  const chains = (rows) => rows.every((row, index) => index === 0 || rows[index - 1].newStock === row.previousStock);

  console.log("\nStock in and stock out are recorded in full");
  const item = await newItem("Test gauze");
  await stockIn(item, { quantity: 30, batchNumber: "LOT-A", source: "City health office", referenceNumber: "DR-100", remarks: "Delivery" });
  let [row] = await rowsOf(item);
  check("stock in has a reference, snapshot and destination", /^MV-\d{4}-[0-9A-F]{8}$/.test(row.reference) && row.itemName === "Test gauze" && row.itemUnit === "piece" && row.destinationName.includes("Health Center"));
  check("stock in keeps source, reference number and before/after", row.source === "City health office" && row.referenceNumber === "DR-100" && row.previousStock === 0 && row.newStock === 30);
  check("stock in names who recorded it", row.performedByName === bhw.user.fullname && row.status === "completed");
  await stockIn(item, { quantity: 10, batchNumber: "LOT-B" });

  const out = await stockOut(item, { quantity: 35, remarks: "Across two lots" });
  check("a release across two lots succeeds", out.status === 200 && out.body.item.currentStock === 5, `${out.status} ${out.body.message}`);
  let rows = await rowsOf(item);
  const issued = rows.filter((entry) => entry.type === "STOCK_OUT");
  check("it writes one row per lot", issued.length === 2 && issued[0].quantity + issued[1].quantity === 35);
  check("destination, recipient and source are recorded", issued.every((entry) => entry.destinationName === TO.destinationName && entry.recipient === TO.recipient && entry.recipientDesignation === "Nurse" && entry.source.includes("Health Center")));
  check("a release is issued, never received", issued.every((entry) => entry.status === "issued"));
  check("before and after counts chain across the whole ledger", chains(rows));

  console.log("\nA release must say where it went and who took it");
  for (const [label, body] of [["no destination", { destinationName: "" }], ["no recipient", { recipient: "" }]]) {
    const res = await stockOut(item, { quantity: 1, ...body });
    check(`${label} is refused (400)`, res.status === 400, `${res.status}`);
  }
  check("a damage write-off needs neither", (await call(bhw, `/inventory/items/${item}/stock-out`, "POST", { quantity: 1, reason: "Crushed box", type: "DAMAGED" })).status === 200);

  console.log("\nRepeated submissions move stock once");
  const opId = "retry-operation-0001";
  const first = await stockOut(item, { quantity: 1, operationId: opId });
  const before = await stockOf(item);
  const second = await stockOut(item, { quantity: 1, operationId: opId });
  check("a retry returns success", first.status === 200 && second.status === 200);
  check("and does not deduct again", (await stockOf(item)) === before && before === 3, `${before}`);
  check("and writes one row", (await InventoryTransaction.countDocuments({ operationId: opId })) === 1);
  check("and logs one system entry", (await SystemLog.countDocuments({ action: "INVENTORY_STOCK_OUT", resourceId: item })) === 2, `${await SystemLog.countDocuments({ action: "INVENTORY_STOCK_OUT", resourceId: item })}`);
  const parallelOp = "parallel-operation-02";
  const twins = await Promise.all([1, 2].map(() => stockIn(item, { quantity: 4, batchNumber: "LOT-C", operationId: parallelOp })));
  check("two identical stock-ins at once both answer success", twins.every((res) => res.status === 200), twins.map((res) => res.status).join(","));
  check("but add stock once", (await stockOf(item)) === 7 && (await InventoryTransaction.countDocuments({ operationId: parallelOp })) === 1, `${await stockOf(item)}`);
  check("a malformed request id is refused", (await stockOut(item, { quantity: 1, operationId: "a b" })).status === 400);

  console.log("\nConcurrent releases cannot oversell, and failed ones leave no trace");
  const race = await newItem("Test race item");
  await stockIn(race, { quantity: 5, batchNumber: "LOT-R" });
  const results = await Promise.all([1, 2, 3, 4].map(() => stockOut(race, { quantity: 2 })));
  check("two of four releases of 2 from 5 succeed", results.filter((res) => res.status === 200).length === 2, results.map((res) => res.status).join(","));
  rows = await rowsOf(race);
  check("the stock is 1 and the ledger agrees", (await stockOf(race)) === 1 && rows.at(-1).newStock === 1 && chains(rows));
  check("refused releases wrote no rows", rows.length === 3, `${rows.length}`);
  const zero = await newItem("Test empty item");
  check("releasing an empty item is refused (409)", (await stockOut(zero, { quantity: 1 })).status === 409);
  check("and nothing is recorded", (await rowsOf(zero)).length === 0);

  console.log("\nA lot that expires leaves a record");
  const perish = await newItem("Test expiring item");
  await stockIn(perish, { quantity: 8, batchNumber: "LOT-OLD" });
  await stockIn(perish, { quantity: 2, batchNumber: "LOT-NEW" });
  await InventoryBatch.updateOne({ item: perish, batchNumber: "LOT-OLD" }, { expiryDate: new Date(Date.now() - 3 * DAY_MS) });
  await Promise.all([1, 2, 3].map(() => call(admin, `/inventory/items/${perish}`)));
  rows = await rowsOf(perish);
  const expired = rows.filter((entry) => entry.type === "EXPIRED");
  check("three reads at once write exactly one expiry row", expired.length === 1, `${expired.length}`);
  check("by the system, for the whole lot", expired[0]?.recordedBySystem === true && expired[0].quantity === 8 && expired[0].performedByName === "System");
  check("and the ledger still matches the stock", (await stockOf(perish)) === 2 && rows.at(-1).newStock === 2 && chains(rows));

  console.log("\nReturns");
  const ret = await newItem("Test return item");
  await stockIn(ret, { quantity: 10, batchNumber: "LOT-RT" });
  await stockOut(ret, { quantity: 6 });
  const issueRow = (await rowsOf(ret)).at(-1);
  const returnOf = (id, body) => call(bhw, `/inventory/movements/${id}/return`, "POST", { reason: "Not needed", ...body });
  check("usable stock needs inspection first (400)", (await returnOf(issueRow._id, { quantity: 1, condition: "usable" })).status === 400);
  check("a condition is required (400)", (await returnOf(issueRow._id, { quantity: 1 })).status === 400);
  const partial = await returnOf(issueRow._id, { quantity: 2, condition: "usable", verified: true });
  check("an inspected partial return goes back into stock", partial.status === 200 && (await stockOf(ret)) === 6, `${partial.status} ${partial.body.message}`);
  const damaged = await returnOf(issueRow._id, { quantity: 1, condition: "damaged" });
  check("a damaged return is recorded but not added", damaged.status === 200 && (await stockOf(ret)) === 6);
  const retRows = await InventoryTransaction.find({ relatedTransaction: issueRow._id }).lean();
  check("returns reference the original and hold the condition", retRows.length === 2 && retRows.every((entry) => entry.relation === "return" && entry.returnCondition));
  check("a return beyond what is left is refused (409)", (await returnOf(issueRow._id, { quantity: 4, condition: "damaged" })).status === 409);
  const over = await Promise.all([1, 2].map(() => returnOf(issueRow._id, { quantity: 2, condition: "damaged" })));
  check("two returns racing for the last 3 cannot both pass", over.filter((res) => res.status === 200).length === 1, over.map((res) => res.status).join(","));
  check("a stock-in cannot be returned (409)", (await returnOf((await rowsOf(ret))[0]._id, { quantity: 1, condition: "damaged" })).status === 409);
  check("a release with returns cannot be reversed (409)", (await call(bhw, `/inventory/movements/${issueRow._id}/reverse`, "POST", { reason: "Mistake" })).status === 409);

  console.log("\nA reversed return frees its quantity again");
  const undo = await newItem("Test undo return item");
  await stockIn(undo, { quantity: 10, batchNumber: "LOT-U" });
  await stockOut(undo, { quantity: 6 });
  const undoIssue = (await rowsOf(undo)).at(-1);
  await returnOf(undoIssue._id, { quantity: 6, condition: "usable", verified: true });
  check("all 6 are back", (await stockOf(undo)) === 10);
  check("nothing more can be returned", (await returnOf(undoIssue._id, { quantity: 1, condition: "damaged" })).status === 409);
  const undoReturn = (await rowsOf(undo)).at(-1);
  const undone = await call(bhw, `/inventory/movements/${undoReturn._id}/reverse`, "POST", { reason: "Returned against the wrong release" });
  check("the return can be reversed, taking the stock back out", undone.status === 200 && (await stockOf(undo)) === 4, `${undone.status} ${undone.body.message}`);
  const returnedAgain = await returnOf(undoIssue._id, { quantity: 6, condition: "damaged" });
  check("its quantity can be returned again", returnedAgain.status === 200, `${returnedAgain.status} ${returnedAgain.body.message}`);
  const damagedReturn = (await rowsOf(undo)).at(-1);
  const undoDamaged = await call(bhw, `/inventory/movements/${damagedReturn._id}/reverse`, "POST", { reason: "Entered in error" });
  check("a return that changed no stock can still be reversed", undoDamaged.status === 200 && (await stockOf(undo)) === 4, `${undoDamaged.status} ${undoDamaged.body.message}`);
  const undoHistory = await call(bhw, `/inventory/items/${undo}/history`);
  const undoEntry = undoHistory.body.history.find((entry) => entry._id === String(undoIssue._id));
  check("the release can now be returned or reversed again", undoEntry?.corrections?.returnable === 6 && undoEntry.corrections.reversible === true, JSON.stringify(undoEntry?.corrections));
  check("the ledger still chains", chains(await rowsOf(undo)));

  console.log("\nReversals keep the original");
  const rev = await newItem("Test reversal item");
  await stockIn(rev, { quantity: 10, batchNumber: "LOT-V" });
  await stockOut(rev, { quantity: 10 });
  const wrong = (await rowsOf(rev)).at(-1);
  const frozen = JSON.stringify(wrong);
  const reverseOf = (id, body = {}) => call(bhw, `/inventory/movements/${id}/reverse`, "POST", { reason: "Entered in error", ...body });
  check("a reason is required (400)", (await call(bhw, `/inventory/movements/${wrong._id}/reverse`, "POST", {})).status === 400);
  const reversals = await Promise.all([1, 2].map(() => reverseOf(wrong._id)));
  check("two reversals at once: only one applies", reversals.filter((res) => res.status === 200).length === 1, reversals.map((res) => res.status).join(","));
  check("the stock is restored and the depleted lot is active again", (await stockOf(rev)) === 10 && (await InventoryBatch.findOne({ item: rev }).lean()).status === "active");
  check("the original row is untouched", JSON.stringify(await InventoryTransaction.findById(wrong._id).lean()) === frozen);
  const reversal = await InventoryTransaction.findOne({ relatedTransaction: wrong._id, relation: "reversal" }).lean();
  check("a reversal cannot be reversed (409)", (await reverseOf(reversal._id)).status === 409);
  check("the system's expiry rows cannot be reversed (409)", (await reverseOf(expired[0]._id)).status === 409);

  console.log("\nCount corrections");
  const count = await newItem("Test count item");
  await stockIn(count, { quantity: 10, batchNumber: "LOT-K" });
  const lot = await InventoryBatch.findOne({ item: count }).lean();
  const adjust = (body) => call(bhw, `/inventory/items/${count}/adjust`, "POST", { batchId: String(lot._id), category: "physical_count", reason: "Shelf count", ...body });
  check("a reason is required (400)", (await adjust({ countedQuantity: 7, reason: "" })).status === 400);
  check("a category is required (400)", (await adjust({ countedQuantity: 7, category: "nope" })).status === 400);
  check("a matching count is refused (400)", (await adjust({ countedQuantity: 10 })).status === 400);
  const down = await adjust({ countedQuantity: 7 });
  check("a lower count takes stock down", down.status === 200 && (await stockOf(count)) === 7, `${down.status} ${down.body.message}`);
  const up = await adjust({ countedQuantity: 9, category: "manual", reason: "Found a box" });
  check("a higher count brings stock up", up.status === 200 && (await stockOf(count)) === 9);
  const adjustRows = (await rowsOf(count)).filter((entry) => entry.type === "ADJUSTMENT");
  check("each records reason and user", adjustRows.length === 2 && adjustRows[0].reason === "Physical count: Shelf count" && adjustRows[1].quantity === 2 && adjustRows[1].performedByName === bhw.user.fullname);
  check("a lot of another item is refused (404)", (await call(bhw, `/inventory/items/${race}/adjust`, "POST", { batchId: String(lot._id), countedQuantity: 1, category: "lost", reason: "x" })).status === 404);

  console.log("\nHistory reads, filters and summary");
  const list = (query = "") => call(admin, `/inventory/movements?limit=100${query}`);
  const all = await list();
  check("the admin can read the history", all.status === 200 && all.body.total === (await InventoryTransaction.countDocuments()), `${all.status} ${all.body.total}`);
  const one = all.body.movements.find((entry) => entry._id === String(wrong._id));
  check("a row reads as reversed once a reversal exists", one?.status === "reversed" && one.links.reversedBy === reversal.reference);
  check("receipt is never claimed", all.body.movements.every((entry) => entry.receivedBy === ""));
  check("search finds a product", (await list("&search=reversal%20item")).body.total === 3, `${(await list("&search=reversal%20item")).body.total}`);
  check("search finds a transaction id", (await list(`&search=${wrong.reference}`)).body.total === 1);
  check("search finds an item code", (await list(`&search=${wrong.itemCode}`)).body.total === 3);
  check("type filter works", (await list("&type=return")).body.movements.every((entry) => entry.type === "RETURNED"));
  check("adjustment covers damaged and expired", (await list("&type=adjustment")).body.movements.some((entry) => entry.type === "EXPIRED"));
  check("recipient filter works", (await list("&recipient=Test%20Receiver")).body.movements.every((entry) => entry.recipient.name === TO.recipient));
  check("destination filter works", (await list("&destination=zone%203")).body.total > 0);
  check("personnel filter works", (await list(`&performedBy=${doctor.user._id}`)).body.total === 0);
  check("filters combine", (await list("&type=stock_in&search=reversal")).body.total === 1);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila" }).format(new Date());
  check("today's range includes the rows", (await list(`&from=${today}&to=${today}`)).body.total === all.body.total);
  check("a past range is empty", (await list("&to=2020-01-01")).body.total === 0);
  check("a backwards range is refused (400)", (await list("&from=2026-02-02&to=2026-01-01")).status === 400);
  check("a bad date is refused (400)", (await list("&from=nonsense")).status === 400);
  check("a regex character is literal", (await list("&search=%5B")).status === 200);
  const page1 = await call(admin, "/inventory/movements?limit=5&page=1");
  const page2 = await call(admin, "/inventory/movements?limit=5&page=2");
  check("paging never repeats a row", page1.body.movements.every((a) => !page2.body.movements.some((b) => b._id === a._id)));

  const sumRev = (await call(admin, `/inventory/movements/summary?search=${encodeURIComponent("Test reversal item")}`)).body.summary;
  check("a reversed release is left out of the totals", sumRev.received === 10 && sumRev.released === 0 && sumRev.adjustments === 0, JSON.stringify(sumRev));
  const sumRet = (await call(admin, `/inventory/movements/summary?search=${encodeURIComponent("Test return item")}`)).body.summary;
  check("returns count on their own, not against releases", sumRet.released === 6 && sumRet.returned === 5, JSON.stringify(sumRet));
  const counted = (await call(admin, `/inventory/movements/summary?search=${encodeURIComponent("Test return item")}&type=return`)).body.typeCounts;
  const totalOf = async (type) => (await list(`&search=${encodeURIComponent("Test return item")}${type === "all" ? "" : `&type=${type}`}`)).body.total;
  for (const type of ["all", "stock_in", "stock_out", "transfer", "return", "adjustment"]) {
    check(`the ${type} segment count equals its list`, counted[type] === (await totalOf(type)), `${counted[type]}`);
  }
  check("the segments ignore the type filter itself", counted.all > counted.return, JSON.stringify(counted));
  const detail = await call(admin, `/inventory/movements/${reversal._id}`);
  check("details link the reversal to its original", detail.status === 200 && detail.body.movement.relatedReference === wrong.reference);

  console.log("\nThe ledger explains every balance");
  const clean = (await call(admin, "/inventory/movements/summary")).body.reconciliation;
  check("no item is out of step", clean.mismatchedCount === 0, JSON.stringify(clean.mismatched));
  await InventoryItem.updateOne({ _id: race }, { currentStock: 99 });
  const dirty = (await call(admin, "/inventory/movements/summary")).body.reconciliation;
  check("stock changed outside the ledger is flagged", dirty.mismatchedCount === 1 && dirty.mismatched[0]._id === race && dirty.mismatched[0].lastRecorded === 1);
  await InventoryItem.updateOne({ _id: race }, { currentStock: 1 });

  console.log("\nHistory outlives the item");
  await call(bhw, `/inventory/items/${rev}`, "DELETE");
  check("a deactivated item keeps its history", (await list("&search=reversal%20item")).body.total === 3);
  await InventoryItem.updateOne({ _id: rev }, { name: "Renamed later" });
  check("rows keep the name used at the time", (await list("&search=reversal%20item")).body.movements.every((entry) => entry.item.name === "Test reversal item"));
  check("a deactivated item's stock cannot be corrected", (await InventoryTransaction.findOne({ item: rev, type: "STOCK_IN" }).lean()) && (await reverseOf((await InventoryTransaction.findOne({ item: rev, type: "STOCK_IN" }).lean())._id)).status === 409);

  console.log("\nCSV export");
  const InventoryExportPatient = await createUser("resident");
  const patientItem = await newItem("Test dispensed item");
  await stockIn(patientItem, { quantity: 3, batchNumber: "LOT-P" });
  await call(bhw, `/inventory/items/${patientItem}/stock-out`, "POST", { ...TO, quantity: 1, reason: "Dispensed", recipient: "Private Patient Name", relatedPatient: String(InventoryExportPatient.user._id) });
  const csvCall = (query) => request(`/inventory/movements/export${query}`, { token: admin.token, raw: true });
  const csv = await csvCall("?search=dispensed");
  check("the export downloads", csv.status === 200 && csv.text.startsWith("﻿\"Transaction ID\""), `${csv.status}`);
  check("it honors the filters", csv.text.trim().split("\r\n").length === 3, `${csv.text.trim().split("\r\n").length}`);
  check("the patient name never leaves the system", !csv.text.includes("Private Patient Name") && csv.text.includes("Patient (appointment dispensing)"));
  const staffCsv = await csvCall("?search=Test%20gauze");
  check("non-patient recipients stay in the file", staffCsv.text.includes(TO.recipient));
  check("a release says receipt is unconfirmed", staffCsv.text.includes("Issued, receipt not confirmed"));
  const seeded = await stockOut(patientItem, { quantity: 1, recipient: "=HYPERLINK(1)" });
  check("(setup) formula recipient released", seeded.status === 200);
  check("spreadsheet formulas are defused", (await csvCall("?search=dispensed")).text.includes("\"'=HYPERLINK(1)\""));
  const exportLog = await SystemLog.findOne({ action: "INVENTORY_HISTORY_EXPORTED" }).sort({ createdAt: -1 }).lean();
  check("the export is logged without its search text", exportLog && exportLog.metadata.searched === true && !JSON.stringify(exportLog).includes("dispensed"));
  const onScreen = (await list("&search=dispensed")).body.movements.find((entry) => entry.recipient.name === "Private Patient Name");
  check("the admin still sees the name on screen", Boolean(onScreen?.isPatientDispensing));

  console.log("\nWho can see and do what");
  const moveId = String(wrong._id);
  const reads = ["/inventory/movements", "/inventory/movements/summary", "/inventory/movements/filters", "/inventory/movements/export", `/inventory/movements/${moveId}`];
  for (const who of [["doctor", doctor], ["midwife", midwife], ["bhw", bhw], ["resident", resident]]) {
    const statuses = await Promise.all(reads.map((path) => call(who[1], path)));
    check(`${who[0]} cannot read the facility-wide history (403)`, statuses.every((res) => res.status === 403), statuses.map((res) => res.status).join(","));
  }
  check("no sign-in is refused (401)", (await request("/inventory/movements")).status === 401);
  const countBefore = await InventoryTransaction.countDocuments();
  for (const who of [["admin", admin], ["doctor", doctor], ["midwife", midwife], ["resident", resident]]) {
    const writes = await Promise.all([
      call(who[1], `/inventory/movements/${moveId}/reverse`, "POST", { reason: "x" }),
      call(who[1], `/inventory/movements/${moveId}/return`, "POST", { reason: "x", quantity: 1, condition: "damaged" }),
      call(who[1], `/inventory/items/${count}/adjust`, "POST", { batchId: String(lot._id), countedQuantity: 1, category: "lost", reason: "x" }),
    ]);
    check(`${who[0]} cannot correct stock (403)`, writes.every((res) => res.status === 403), writes.map((res) => res.status).join(","));
  }
  check("no refused correction wrote a row", (await InventoryTransaction.countDocuments()) === countBefore);
  check("the admin's list says ledger yes, correct no", (await call(admin, "/inventory/items")).body.permissions.ledger === true && (await call(admin, "/inventory/items")).body.permissions.correct === false);
  const bhwHistory = await call(bhw, `/inventory/items/${ret}/history`);
  check("a BHW's item history says what can be corrected", typeof bhwHistory.body.history[0]?.corrections?.reversible === "boolean");
  const adminHistory = await call(admin, `/inventory/items/${ret}/history`);
  check("an admin's item history does not", adminHistory.body.history[0]?.corrections === undefined);

  console.log("\nRecords cannot be edited");
  const attempts = [
    () => InventoryTransaction.updateOne({ _id: wrong._id }, { quantity: 1 }),
    () => InventoryTransaction.findByIdAndUpdate(wrong._id, { quantity: 1 }),
    () => InventoryTransaction.updateMany({}, { reason: "x" }),
    () => InventoryTransaction.deleteOne({ _id: wrong._id }),
    () => InventoryTransaction.deleteMany({}),
    () => InventoryTransaction.findByIdAndDelete(wrong._id),
    async () => { const doc = await InventoryTransaction.findById(wrong._id); doc.quantity = 1; await doc.save(); },
    async () => { const doc = await InventoryTransaction.findById(wrong._id); await doc.deleteOne(); },
    () => InventoryTransaction.bulkWrite([{ deleteOne: { filter: { _id: wrong._id } } }]),
  ];
  for (const [index, attempt] of attempts.entries()) {
    let refused = false;
    try { await attempt(); } catch (error) { refused = /permanent/.test(error.message); }
    check(`edit attempt ${index + 1} is refused by the model`, refused);
  }
  check("the row is unchanged afterwards", JSON.stringify(await InventoryTransaction.findById(wrong._id).lean()) === frozen);

  console.log("\nRollback: a failed write leaves no change");
  const rollback = await newItem("Test rollback item");
  await stockIn(rollback, { quantity: 5, batchNumber: "LOT-X" });
  const originalCreate = InventoryTransaction.create;
  InventoryTransaction.create = async () => { throw new Error("Simulated ledger failure"); };
  const failed = await stockOut(rollback, { quantity: 2 });
  InventoryTransaction.create = originalCreate;
  check("the request fails", failed.status >= 500, `${failed.status}`);
  check("the stock did not change", (await stockOf(rollback)) === 5);
  check("the lot did not change", (await InventoryBatch.findOne({ item: rollback }).lean()).quantityRemaining === 5);
  check("no row was written", (await rowsOf(rollback)).length === 1);

  console.log("\nItem codes are unique and the full id stays the identity");
  const codedId = await newItem("Test coded item");
  const coded = await InventoryItem.findById(codedId).lean();
  check("a new item gets a stored code from its own id", coded.itemCode === `IT-${codedId.slice(-6).toUpperCase()}`);
  await stockIn(codedId, { quantity: 1, batchNumber: "LOT-CD" });
  const codedRow = (await rowsOf(codedId))[0];
  check("the ledger keeps the code, the lot and the full item id apart", codedRow.itemCode === coded.itemCode && codedRow.batchNumber === "LOT-CD" && String(codedRow.item) === codedId);
  let duplicateRefused = false;
  try { await InventoryItem.create({ name: "Test duplicate code", category: "other", unit: "piece", reorderLevel: 1, itemCode: coded.itemCode }); } catch (error) { duplicateRefused = error.code === 11000; }
  check("the database refuses a second item with the same code", duplicateRefused);
  const realCreate = InventoryItem.create.bind(InventoryItem);
  let createCalls = 0;
  InventoryItem.create = async (fields) => {
    createCalls += 1;
    if (createCalls === 1) throw Object.assign(new Error("duplicate"), { code: 11000, keyPattern: { itemCode: 1 } });
    return realCreate(fields);
  };
  const retried = await call(bhw, "/inventory/items", "POST", { name: "Test retried code", category: "equipment", unit: "piece", reorderLevel: 1 });
  InventoryItem.create = realCreate;
  check("a code clash when adding an item retries instead of failing", retried.status === 201 && createCalls === 2, `${retried.status} ${createCalls}`);

  console.log("\nMigration of rows from before this feature");
  const legacyItem = await InventoryItem.create({ name: "Legacy item", category: "supply", unit: "box", reorderLevel: 1, currentStock: 4 });
  const legacyId = new (require("mongoose").Types.ObjectId)();
  await InventoryTransaction.collection.insertOne({ _id: legacyId, item: legacyItem._id, type: "STOCK_OUT", quantity: 1, previousStock: 7, newStock: 6, performedBy: bhw.user._id, performedByRole: "bhw", reason: "Old release", recipient: "Old", createdAt: new Date("2025-03-03"), updatedAt: new Date("2025-03-03") });
  const mongoose = require("mongoose");
  const clashA = new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaa123456");
  const clashB = new mongoose.Types.ObjectId("bbbbbbbbbbbbbbbbbb123456");
  const legacyFields = { category: "other", unit: "piece", reorderLevel: 1, currentStock: 0, isActive: true };
  await InventoryItem.collection.insertMany([{ _id: clashA, name: "Legacy clash A", ...legacyFields }, { _id: clashB, name: "Legacy clash B", ...legacyFields }]);
  const dry = await runMigration({ dryRun: true });
  check("a dry run reports the codes it would add", dry.itemCodes === 2, JSON.stringify(dry));
  check("a dry run writes nothing", dry.rowsToBackfill === 1 && dry.openingBalances === 1 && !(await InventoryTransaction.collection.findOne({ _id: legacyId })).reference, JSON.stringify(dry));
  await runMigration({ dryRun: false });
  const [codeA, codeB] = await Promise.all([clashA, clashB].map((id) => InventoryItem.collection.findOne({ _id: id })));
  check("two old items sharing six id characters get different codes", codeA.itemCode === "IT-123456" && codeB.itemCode === "IT-BB123456", `${codeA.itemCode} ${codeB.itemCode}`);
  const migrated = await InventoryTransaction.collection.findOne({ _id: legacyId });
  check("old rows gain a reference and snapshot", migrated.reference?.startsWith("MV-2025-") && migrated.itemName === "Legacy item" && migrated.performedByName === bhw.user.fullname);
  check("stored facts are not altered", migrated.quantity === 1 && migrated.recipient === "Old" && !migrated.destinationName);
  const opening = await InventoryTransaction.collection.findOne({ item: legacyItem._id, relation: "opening" });
  check("the unexplained difference becomes one opening row", opening?.previousStock === 6 && opening.newStock === 4 && opening.quantity === 2);
  check("the balance now reconciles", (await call(admin, "/inventory/movements/summary")).body.reconciliation.mismatchedCount === 0);
  const again = await runMigration({ dryRun: false });
  check("running it again changes nothing", again.itemCodes === 0 && again.rowsToBackfill === 0 && again.openingBalances === 0, JSON.stringify(again));
  const legacySum = (await call(admin, "/inventory/movements/summary?search=Legacy")).body.summary;
  check("an opening row is not counted as an adjustment", legacySum.adjustments === 0 && legacySum.released === 1, JSON.stringify(legacySum));
};

(async () => {
  const { check, tally } = createChecker();
  const harness = await startHarness();
  try {
    await run(harness, check);
  } catch (error) {
    check("the suite ran to the end", false, error.stack);
  }
  await finish(harness, tally);
})();
