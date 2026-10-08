"use strict";

const { createChecker, startHarness, createUser, finish } = require("./helpers/appointmentHarness");
const InventoryItem = require("../../models/InventoryItem");
const InventoryBatch = require("../../models/InventoryBatch");

const DAY_MS = 24 * 60 * 60 * 1000;
const dateKey = (offsetDays) => {
  const day = new Date(Date.now() + offsetDays * DAY_MS);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

const run = async ({ request }, check) => {
  const admin = await createUser("admin");
  const bhw = await createUser("bhw");
  const doctor = await createUser("doctor");
  const resident = await createUser("resident");
  const call = (who, path, method = "GET", body) => request(path, { method, token: who.token, body });
  const stockIn = (who, id, body) => call(who, `/inventory/items/${id}/stock-in`, "POST", body);
  const dbStock = async (id) => (await InventoryItem.findById(id).lean()).currentStock;
  const newItem = async (name, category = "equipment") =>
    (await call(admin, "/inventory/items", "POST", { name, category, unit: "piece", reorderLevel: 5 })).body.item._id;

  console.log("\nAdding stock to an item that already holds 50");
  const thermo = await newItem("Test thermometer");
  await stockIn(admin, thermo, { quantity: 50, batchNumber: "LOT-BASE" });
  check("the item starts at 50", (await dbStock(thermo)) === 50);
  const ten = await stockIn(admin, thermo, { quantity: 10, batchNumber: "LOT-A" });
  check("adding 10 gives 60 in the response", ten.status === 200 && ten.body.item?.currentStock === 60, `${ten.status} ${ten.body.message}`);
  check("and 60 in the database", (await dbStock(thermo)) === 60);
  await stockIn(admin, thermo, { quantity: 20, batchNumber: "LOT-B" });
  const five = await stockIn(bhw, thermo, { quantity: 5, batchNumber: "LOT-A" });
  check("50 + 10 + 20 + 5 = 85, and a BHW may add stock", five.status === 200 && five.body.item?.currentStock === 85 && (await dbStock(thermo)) === 85, `${five.status} ${five.body.item?.currentStock}`);
  const lotA = await InventoryBatch.findOne({ item: thermo, batchNumber: "LOT-A" }).lean();
  check("receiving an existing lot tops that lot up instead of creating another", lotA.quantityRemaining === 15 && (await InventoryBatch.countDocuments({ item: thermo, batchNumber: "LOT-A" })) === 1);
  const detail = await call(admin, `/inventory/items/${thermo}`);
  check("the API detail agrees with the database", detail.body.item?.currentStock === 85);

  console.log("\nConcurrent additions");
  const parallel = await Promise.all([10, 20, 5].map((quantity, i) => stockIn(admin, thermo, { quantity, batchNumber: `LOT-P${i}` })));
  check("three simultaneous additions all succeed", parallel.every((r) => r.status === 200), parallel.map((r) => `${r.status} ${r.body.message}`).join(" | "));
  check("none is lost: 85 + 35 = 120", (await dbStock(thermo)) === 120, `${await dbStock(thermo)}`);
  const sameLot = await Promise.all([3, 4].map((quantity) => stockIn(admin, thermo, { quantity, batchNumber: "LOT-NEW" })));
  check("two simultaneous additions to the same new lot both succeed", sameLot.every((r) => r.status === 200), sameLot.map((r) => `${r.status} ${r.body.message}`).join(" | "));
  check("and land in one lot holding 7, for a total of 127", (await InventoryBatch.countDocuments({ item: thermo, batchNumber: "LOT-NEW" })) === 1 && (await dbStock(thermo)) === 127, `${await dbStock(thermo)}`);

  console.log("\nQuantities that must be refused");
  const before = await dbStock(thermo);
  for (const [label, quantity] of [["zero", 0], ["a negative number", -1], ["an empty string", ""], ["null", null], ["a missing value", undefined], ["not a number", "abc"], ["a decimal", 2.5], ["a decimal string", "2.5"], ["true", true], ["a number past the safe range", 1e20]]) {
    const res = await stockIn(admin, thermo, { quantity, batchNumber: "LOT-BAD" });
    check(`${label} is refused with 400`, res.status === 400, `${res.status} ${res.body.message}`);
  }
  check("no refused request changed the stock or made a lot", (await dbStock(thermo)) === before && !(await InventoryBatch.exists({ item: thermo, batchNumber: "LOT-BAD" })));
  const numericString = await stockIn(admin, thermo, { quantity: "3", batchNumber: "LOT-STR" });
  check("a whole number sent as text is accepted as that number", numericString.status === 200 && (await dbStock(thermo)) === before + 3);

  console.log("\nExpiry rules for perishable stock");
  const gauze = await newItem("Test gauze", "supply");
  check("supply stock without an expiry date is refused", (await stockIn(admin, gauze, { quantity: 5, batchNumber: "G1" })).status === 400);
  check("supply stock that expired yesterday is refused", (await stockIn(admin, gauze, { quantity: 5, batchNumber: "G1", expiryDate: dateKey(-1) })).status === 400);
  const today = await stockIn(admin, gauze, { quantity: 5, batchNumber: "G1", expiryDate: dateKey(0) });
  check("supply stock expiring today is accepted", today.status === 200 && (await dbStock(gauze)) === 5, `${today.status} ${today.body.message}`);

  console.log("\nWho and what may receive stock");
  check("a doctor is refused (403)", (await stockIn(doctor, thermo, { quantity: 1, batchNumber: "LOT-X" })).status === 403);
  check("a resident is refused (403)", (await stockIn(resident, thermo, { quantity: 1, batchNumber: "LOT-X" })).status === 403);
  check("an unknown item is 404", (await stockIn(admin, "507f1f77bcf86cd799439011", { quantity: 1, batchNumber: "LOT-X" })).status === 404);
  check("a malformed id is 400", (await stockIn(admin, "not-an-id", { quantity: 1, batchNumber: "LOT-X" })).status === 400);
  const retired = await newItem("Test retired scale");
  await call(admin, `/inventory/items/${retired}`, "DELETE");
  check("a deactivated item is 404", (await stockIn(admin, retired, { quantity: 1, batchNumber: "LOT-X" })).status === 404);
  check("a missing lot number is 400", (await stockIn(admin, thermo, { quantity: 1, batchNumber: "  " })).status === 400);

  console.log("\nA lot that lapses leaves the stock count");
  const kit = await newItem("Test kit");
  await stockIn(admin, kit, { quantity: 10, batchNumber: "K-OK" });
  // A lot received earlier that expired overnight: still marked active, still counted.
  await InventoryBatch.create({ item: kit, batchNumber: "K-OLD", quantityReceived: 4, quantityRemaining: 4, expiryDate: new Date(Date.now() - DAY_MS), status: "active" });
  await InventoryItem.updateOne({ _id: kit }, { currentStock: 14 });
  const list = await call(admin, "/inventory/items?limit=100");
  const row = (list.body.items ?? []).find((item) => item._id === kit);
  check("the list shows 10 once the old lot has lapsed", row?.currentStock === 10, `${row?.currentStock}`);
  check("and the database holds 10", (await dbStock(kit)) === 10, `${await dbStock(kit)}`);
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
