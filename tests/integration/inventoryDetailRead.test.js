"use strict";

const { createChecker, startHarness, createUser, finish } = require("./helpers/appointmentHarness");
const InventoryItem = require("../../models/InventoryItem");

const updatedAtOf = async (id) => (await InventoryItem.findById(id).lean()).updatedAt.getTime();

const run = async ({ request }, check) => {
  const admin = await createUser("admin");
  const as = (path, method = "GET", body) => request(path, { method, token: admin.token, body });

  // Equipment is not perishable, so stock can be received without an expiry date.
  const created = await as("/inventory/items", "POST", { name: "Test thermometer", category: "equipment", unit: "piece", reorderLevel: 1 });
  const itemId = created.body.item?._id ?? created.body.item?.id;
  check("a test item is created", created.status === 201 && Boolean(itemId), `${created.status} ${created.body.message}`);

  console.log("\nOpening an item's details does not change the item");
  const beforeRead = await updatedAtOf(itemId);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const firstRead = await as(`/inventory/items/${itemId}`);
  const secondRead = await as(`/inventory/items/${itemId}`);
  check("both reads succeed", firstRead.status === 200 && secondRead.status === 200);
  // Each write is a realtime update, and an open details panel reloads on its own
  // item's update, so a write on read reloaded itself forever.
  check("reading leaves updatedAt as it was", (await updatedAtOf(itemId)) === beforeRead);

  console.log("\nStock changes still update the item");
  const stockIn = await as(`/inventory/items/${itemId}/stock-in`, "POST", { quantity: 5, batchNumber: "TEST-BATCH-1" });
  check("receiving 5 sets the stock to 5", stockIn.status < 300 && stockIn.body.item?.currentStock === 5, `${stockIn.status} ${stockIn.body.message}`);
  const afterStockIn = await updatedAtOf(itemId);
  check("receiving stock changes updatedAt", afterStockIn > beforeRead);

  const stockOut = await as(`/inventory/items/${itemId}/stock-out`, "POST", { quantity: 2, reason: "Test release" });
  check("releasing 2 leaves 3", stockOut.status < 300 && stockOut.body.item?.currentStock === 3, `${stockOut.status} ${stockOut.body.message}`);

  const afterStockOut = await updatedAtOf(itemId);
  await as(`/inventory/items/${itemId}`);
  check("a read after the release still leaves the item alone", (await updatedAtOf(itemId)) === afterStockOut);
  check("the stored stock is still 3", (await InventoryItem.findById(itemId).lean()).currentStock === 3);
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
