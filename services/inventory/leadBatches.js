"use strict";

const InventoryBatch = require("../../models/InventoryBatch");

/** The batch each listed item draws from next (earliest expiry, then oldest), keyed by item id. */
const loadLeadBatches = async (items) => {
  const batches = await InventoryBatch.find({
    item: { $in: items.map((item) => item._id) },
    status: "active",
    quantityRemaining: { $gt: 0 },
  })
    .sort({ expiryDate: 1, receivedDate: 1 })
    .select("item batchNumber expiryDate quantityRemaining")
    .lean();

  const leadBatch = new Map();
  for (const batch of batches) {
    const key = String(batch.item);
    if (!leadBatch.has(key)) leadBatch.set(key, batch);
  }
  return leadBatch;
};

module.exports = { loadLeadBatches };
