"use strict";

const InventoryItem = require("../../models/InventoryItem");
const { serializeItem } = require("../../controllers/inventory/inventory.serializers");
const { loadLeadBatches } = require("../../services/inventory/leadBatches");
const { broadcast } = require("../broadcast");
const { STAFF_ROOM } = require("../rooms");
const { splitChanges } = require("./shared");

// Every staff role holds the inventory "view" permission
// (config/inventoryPermissions.js); residents hold none.
const READERS = [STAFF_ROOM];

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    const items = await InventoryItem.find({ _id: { $in: liveIds } }).populate("supplier", "name type").lean();
    const leadBatch = await loadLeadBatches(items);

    for (const item of items) {
      // The list shows active items only, so a deactivated item leaves it.
      if (!item.isActive) {
        broadcast("inventoryItem", "deleted", { id: String(item._id) }, READERS);
        continue;
      }
      const row = serializeItem(item, { batchNumber: leadBatch.get(String(item._id))?.batchNumber || "" });
      broadcast("inventoryItem", actionOf(item._id), row, READERS);
    }
  }

  for (const id of deletedIds) {
    broadcast("inventoryItem", "deleted", { id }, READERS);
  }
};

module.exports = { name: "inventory", model: InventoryItem, publish };
