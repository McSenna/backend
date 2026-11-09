"use strict";
// Prepares existing inventory movements for the history page. Run with --dry-run first.
//   node scripts/migrations/inventoryMovementLedger.js --dry-run
// Safe to run again: an item with a code or a row with a reference is skipped, and a balance
// that already matches gets no opening row. Stored facts (quantities, reasons, recipients) are never changed.
const mongoose = require("mongoose");
const InventoryItem = require("../../models/InventoryItem");
const InventoryTransaction = require("../../models/InventoryTransaction");
const User = require("../../models/User");
const { FACILITY_NAME, SYSTEM_ACTOR_NAME } = require("../../config/inventoryMovements");

const { movementReference } = InventoryTransaction;
const { itemCodeOf } = InventoryItem;
const BATCH_SIZE = 500;
const NO_REFERENCE = { $or: [{ reference: { $exists: false } }, { reference: null }, { reference: "" }] };
const OPENING_REASON = "Balance carried over when movement tracking began";

const planItemCodes = async () => {
  const items = await InventoryItem.collection.find({}, { projection: { itemCode: 1 } }).sort({ _id: 1 }).toArray();
  const taken = new Set(items.map((item) => item.itemCode).filter(Boolean));

  return items.filter((item) => !item.itemCode).map((item) => {
    // The oldest item keeps the short form; a later clash takes more of its own id.
    let length = 6;
    while (taken.has(itemCodeOf(item._id, length))) length += 2;
    const code = itemCodeOf(item._id, length);
    taken.add(code);
    return { _id: item._id, code };
  });
};

const assignItemCodes = async (planned) => {
  for (const { _id, code } of planned) {
    await InventoryItem.collection.updateOne({ _id }, { $set: { itemCode: code } });
    // Rows written between the API deploy and this run carry the short form.
    await InventoryTransaction.collection.updateMany({ item: _id, itemCode: { $exists: true, $ne: code } }, { $set: { itemCode: code } });
  }
};

const byId = (rows) => new Map(rows.map((row) => [String(row._id), row]));

const snapshotOf = (row, items, users) => {
  const item = items.get(String(row.item));
  return {
    reference: movementReference(row._id, row.createdAt),
    itemName: row.itemName || item?.name || "",
    itemSpecification: row.itemSpecification || item?.specification || "",
    itemCode: item?.itemCode || itemCodeOf(row.item),
    itemCategory: row.itemCategory || item?.category || "",
    itemUnit: row.itemUnit || item?.unit || "",
    performedByName: row.performedByName || users.get(String(row.performedBy))?.fullname || "",
  };
};

const backfillSnapshots = async () => {
  const collection = InventoryTransaction.collection;
  const pending = await collection.find(NO_REFERENCE).toArray();
  const items = byId(await InventoryItem.find({ _id: { $in: pending.map((row) => row.item) } }).select("name specification category unit itemCode").lean());
  const users = byId(await User.find({ _id: { $in: pending.map((row) => row.performedBy).filter(Boolean) } }).select("fullname").lean());

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const operations = pending.slice(start, start + BATCH_SIZE).map((row) => ({
      updateOne: { filter: { _id: row._id }, update: { $set: snapshotOf(row, items, users) } },
    }));
    await collection.bulkWrite(operations, { ordered: false });
  }
  return pending.length;
};

const findOpeningGaps = async () => {
  const [items, lastRows] = await Promise.all([
    InventoryItem.find({ isActive: true }).lean(),
    InventoryTransaction.aggregate([
      { $sort: { item: 1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$item", newStock: { $first: "$newStock" } } },
    ]),
  ]);
  const recorded = new Map(lastRows.map((row) => [String(row._id), row.newStock]));
  return items
    .map((item) => ({ item, lastRecorded: recorded.get(String(item._id)) ?? 0 }))
    .filter(({ item, lastRecorded }) => item.currentStock !== lastRecorded);
};

// Written directly: the model's rules are for live movements, and this one states a balance, not an event.
const openingRow = ({ item, lastRecorded }) => {
  const _id = new mongoose.Types.ObjectId();
  const now = new Date();
  return {
    _id,
    reference: movementReference(_id, now),
    item: item._id,
    batch: null,
    batchNumber: "",
    itemName: item.name,
    itemSpecification: item.specification || "",
    itemCode: item.itemCode || itemCodeOf(item._id),
    itemCategory: item.category,
    itemUnit: item.unit,
    type: "ADJUSTMENT",
    status: "completed",
    relation: "opening",
    quantity: Math.abs(item.currentStock - lastRecorded),
    previousStock: lastRecorded,
    newStock: item.currentStock,
    reason: OPENING_REASON,
    source: FACILITY_NAME,
    performedByName: SYSTEM_ACTOR_NAME,
    performedByRole: "system",
    recordedBySystem: true,
    createdAt: now,
    updatedAt: now,
  };
};

const runMigration = async ({ dryRun = true } = {}) => {
  const planned = await planItemCodes();
  if (dryRun) {
    return {
      itemCodes: planned.length,
      rowsToBackfill: await InventoryTransaction.collection.countDocuments(NO_REFERENCE),
      openingBalances: (await findOpeningGaps()).length,
    };
  }
  await assignItemCodes(planned);
  // Additive on purpose: syncIndexes would drop any index the schema does not list.
  await InventoryItem.createIndexes();
  const gaps = await findOpeningGaps();
  const rowsToBackfill = await backfillSnapshots();
  if (gaps.length > 0) await InventoryTransaction.collection.insertMany(gaps.map(openingRow));
  return { itemCodes: planned.length, rowsToBackfill, openingBalances: gaps.length };
};

module.exports = { runMigration };

if (require.main === module) {
  require("dotenv").config();
  const dryRun = process.argv.includes("--dry-run");
  require("../../config/db")()
    .then(() => runMigration({ dryRun }))
    .then((counts) => process.stdout.write(`${dryRun ? "Dry run, nothing written" : "Migrated"}: ${JSON.stringify(counts)}\n`))
    .catch((error) => {
      process.stderr.write(`Inventory movement migration failed: ${error.message}\n`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
