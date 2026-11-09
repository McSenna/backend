"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryTransaction = require("../../models/InventoryTransaction");
const { MOVEMENT_GROUPS } = require("../../config/inventoryMovements");

const RECONCILIATION_SAMPLE = 5;

// A reversed movement never happened as far as the totals go, and neither do the
// reversal itself or a carried-over opening balance, so nothing counts twice.
const countableFilter = async (filter) => {
  const reversed = await InventoryTransaction.distinct("relatedTransaction", { relation: "reversal" });
  return { ...filter, relation: { $nin: ["reversal", "opening"] }, _id: { $nin: reversed } };
};

const summarizeMovements = async (filter) => {
  const rows = await InventoryTransaction.aggregate([
    { $match: await countableFilter(filter) },
    { $group: { _id: "$type", quantity: { $sum: "$quantity" }, count: { $sum: 1 } } },
  ]);

  const byType = new Map(rows.map((row) => [row._id, row]));
  const total = (types, field) => types.reduce((sum, type) => sum + (byType.get(type)?.[field] ?? 0), 0);

  return {
    received: total(MOVEMENT_GROUPS.stock_in, "quantity"),
    released: total([...MOVEMENT_GROUPS.stock_out, ...MOVEMENT_GROUPS.transfer], "quantity"),
    returned: total(MOVEMENT_GROUPS.return, "quantity"),
    adjustments: total(MOVEMENT_GROUPS.adjustment, "count"),
  };
};

const SEGMENT_GROUPS = ["stock_in", "stock_out", "transfer", "return", "adjustment"];

// Counts every listed row, reversed ones included, so a segment's number equals the list it opens.
const countByType = async (filter) => {
  const rows = await InventoryTransaction.aggregate([{ $match: filter }, { $group: { _id: "$type", count: { $sum: 1 } } }]);
  const byType = new Map(rows.map((row) => [row._id, row.count]));
  const counts = { all: rows.reduce((sum, row) => sum + row.count, 0) };
  for (const group of SEGMENT_GROUPS) {
    counts[group] = MOVEMENT_GROUPS[group].reduce((sum, type) => sum + (byType.get(type) ?? 0), 0);
  }
  return counts;
};

// The last recorded balance must equal the stock on hand. A difference means stock
// moved without a record, which the ledger exists to rule out.
const reconcileStock = async () => {
  const [items, lastRows] = await Promise.all([
    InventoryItem.find({ isActive: true }).select("name specification unit currentStock").lean(),
    InventoryTransaction.aggregate([
      { $sort: { item: 1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$item", newStock: { $first: "$newStock" } } },
    ]),
  ]);

  const recorded = new Map(lastRows.map((row) => [String(row._id), row.newStock]));
  const mismatched = items
    .map((item) => ({ item, lastRecorded: recorded.get(String(item._id)) ?? 0 }))
    .filter(({ item, lastRecorded }) => item.currentStock !== lastRecorded);

  return {
    checkedItems: items.length,
    mismatchedCount: mismatched.length,
    mismatched: mismatched.slice(0, RECONCILIATION_SAMPLE).map(({ item, lastRecorded }) => ({
      _id: String(item._id),
      name: item.name,
      specification: item.specification || "",
      unit: item.unit,
      currentStock: item.currentStock,
      lastRecorded,
    })),
  };
};

module.exports = { summarizeMovements, countByType, reconcileStock };
