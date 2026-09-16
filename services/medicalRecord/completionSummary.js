"use strict";

const buildDispensedSummary = (dispensed) =>
  dispensed.map((entry) => ({
    item: entry.recordEntry.itemName,
    quantity: entry.recordEntry.quantity,
    unit: entry.recordEntry.unit,
  }));

const buildDispensedSentence = (summary) => {
  if (summary.length === 1) {
    return ` and dispensed ${summary[0].quantity} ${summary[0].unit} of ${summary[0].item}`;
  }
  if (summary.length > 1) {
    return ` and dispensed ${summary.length} inventory items`;
  }
  return "";
};

const buildInventoryTransactions = (dispensed) =>
  dispensed.flatMap((entry) =>
    entry.transactions.map((transaction) => ({
      _id: String(transaction._id),
      item: String(transaction.item),
      itemName: entry.recordEntry.itemName,
      unit: entry.recordEntry.unit,
      batchNumber: transaction.batchNumber || "",
      quantity: transaction.quantity,
      previousStock: transaction.previousStock,
      newStock: transaction.newStock,
    }))
  );

module.exports = { buildDispensedSummary, buildDispensedSentence, buildInventoryTransactions };
