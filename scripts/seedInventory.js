"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("../config/db");
const InventoryItem = require("../models/InventoryItem");
const InventoryBatch = require("../models/InventoryBatch");
const InventoryTransaction = require("../models/InventoryTransaction");
const Supplier = require("../models/Supplier");
const User = require("../models/User");
const { recalculateItemStock } = require("../services/inventoryService");
const logger = require("../utils/logger");
const { SUPPLIERS, ITEMS } = require("./seed/inventorySeedData");

async function seedInventory({ force = false } = {}) {
  const existing = await InventoryItem.countDocuments({});
  if (existing > 0 && !force) {
    logger.warn(
      `Inventory already holds ${existing} item(s); refusing to seed. Re-run with --force to replace it.`
    );
    return { seeded: 0, skipped: true };
  }

  if (force && existing > 0) {
    await Promise.all([
      InventoryItem.deleteMany({}),
      InventoryBatch.deleteMany({}),
      InventoryTransaction.deleteMany({}),
    ]);
    logger.info("Cleared existing inventory before reseeding");
  }

  const supplierIds = new Map();
  for (const supplier of SUPPLIERS) {
    const record = await Supplier.findOneAndUpdate(
      { name: supplier.name },
      { $setOnInsert: supplier },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
    );
    supplierIds.set(supplier.name, record._id);
  }

  const actor = await User.findOne({ role: "admin" }).select("_id role").lean();
  if (!actor) {
    throw new Error("No admin account found. Start the server once so seedAdmin runs, then retry.");
  }

  let seeded = 0;

  for (const definition of ITEMS) {
    const { batch, supplier: supplierName, ...metadata } = definition;

    const item = await InventoryItem.create({
      ...metadata,
      supplier: supplierIds.get(supplierName) || null,
      currentStock: 0,
      createdBy: actor._id,
      updatedBy: actor._id,
    });

    const receivedDate = daysAgo(batch.receivedDaysAgo);

    const created = await InventoryBatch.create({
      item: item._id,
      batchNumber: batch.batchNumber,
      quantityReceived: batch.quantity,
      quantityRemaining: batch.quantity,
      expiryDate: batch.expiryInDays === null ? null : daysFromNow(batch.expiryInDays),
      receivedDate,
      supplier: supplierIds.get(supplierName) || null,
      storageCondition: metadata.storageCondition,
      receivedBy: actor._id,
      status: "active",
    });

    await InventoryTransaction.create({
      item: item._id,
      batch: created._id,
      batchNumber: created.batchNumber,
      type: "STOCK_IN",
      quantity: batch.quantity,
      previousStock: 0,
      newStock: batch.quantity,
      reason: "Opening stock received",
      source: supplierName,
      performedBy: actor._id,
      performedByRole: actor.role,
      createdAt: receivedDate,
    });

    if (batch.releaseAll) {
      await InventoryBatch.findByIdAndUpdate(created._id, {
        quantityRemaining: 0,
        status: "depleted",
      });
      await InventoryTransaction.create({
        item: item._id,
        batch: created._id,
        batchNumber: created.batchNumber,
        type: "STOCK_OUT",
        quantity: batch.quantity,
        previousStock: batch.quantity,
        newStock: 0,
        reason: "Dispensed during health mission",
        recipient: "Barangay Health Station",
        performedBy: actor._id,
        performedByRole: actor.role,
      });
    }

    await InventoryItem.findByIdAndUpdate(item._id, { lastRestockedAt: receivedDate });
    await recalculateItemStock(item._id);
    seeded += 1;
  }

  return { seeded, skipped: false };
}

async function main() {
  const force = process.argv.includes("--force");

  try {
    await connectDB();
    const { seeded, skipped } = await seedInventory({ force });
    if (!skipped) logger.info(`Seeded ${seeded} inventory item(s)`);
  } catch (error) {
    logger.error("Inventory seeding failed", { errorName: error?.name, errorMessage: error?.message });
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { seedInventory, ITEMS, SUPPLIERS };
