"use strict";

const InventoryItem = require("../../models/InventoryItem");
const InventoryTransaction = require("../../models/InventoryTransaction");
const { conflict, notFound } = require("../../utils/AppError");

const loadOriginal = async (transactionId, session) => {
  const original = await InventoryTransaction.findById(transactionId).session(session);
  if (!original) throw notFound("That inventory movement could not be found.");
  return original;
};

const assertNotReversed = async (original, session) => {
  const reversal = await InventoryTransaction.exists({ relatedTransaction: original._id, relation: "reversal" }).session(session);
  if (reversal) throw conflict(`${original.reference || "This movement"} has already been reversed.`);
};

// A return that was itself reversed never happened, so it frees that quantity again.
const returnedSoFar = async (original, session) => {
  const returns = await InventoryTransaction.find({ relatedTransaction: original._id, relation: "return" })
    .select("quantity")
    .session(session)
    .lean();
  if (returns.length === 0) return 0;

  const reversed = await InventoryTransaction.distinct("relatedTransaction", {
    relation: "reversal",
    relatedTransaction: { $in: returns.map((row) => row._id) },
  }).session(session);
  const undone = new Set(reversed.map(String));
  return returns.filter((row) => !undone.has(String(row._id))).reduce((sum, row) => sum + row.quantity, 0);
};

const replayedItem = (itemId, session) => InventoryItem.findById(itemId).session(session);

const assertActiveItem = (item) => {
  if (item.isActive === false) throw conflict(`${item.name} has been deactivated, so its stock cannot change.`);
};

module.exports = { loadOriginal, assertNotReversed, returnedSoFar, replayedItem, assertActiveItem };
