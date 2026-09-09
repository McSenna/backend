"use strict";

/**
 * Loads a demonstration inventory.
 *
 * Deliberately a script rather than part of `seedAdmin`: sample stock must
 * never appear in a production database on boot, and a health centre's real
 * opening stock is received through Add Stock so it lands in the ledger like
 * every other movement. Run it explicitly:
 *
 *   node utils/seedInventory.js
 *
 * It refuses to run against a database that already holds inventory unless
 * `--force` is passed, so it cannot quietly duplicate a real catalogue.
 */

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

const SUPPLIERS = [
  { name: "DOH Regional Office V", type: "doh", contactPerson: "Regional Pharmacist" },
  { name: "City Health Office", type: "city-health", contactPerson: "Supply Officer" },
  { name: "Barangay LGU", type: "lgu", contactPerson: "Barangay Secretary" },
];

const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date;
};

const daysAgo = (days) => daysFromNow(-days);

/**
 * The rows the Inventory Management design shows.
 *
 * Expiry dates are expressed as offsets from today rather than fixed dates so
 * the seeded data keeps demonstrating each status band — "Expiring Soon" stops
 * meaning anything once a hardcoded date drifts into the past.
 */
const ITEMS = [
  {
    name: "Paracetamol 500mg",
    specification: "Tablet",
    genericName: "Paracetamol",
    category: "medicine",
    unit: "tabs",
    reorderLevel: 50,
    storageCondition: "room-temperature",
    supplier: "City Health Office",
    batch: { batchNumber: "PAR2024091", quantity: 250, expiryInDays: 460, receivedDaysAgo: 30 },
  },
  {
    name: "Amoxicillin 250mg",
    specification: "Capsule",
    genericName: "Amoxicillin",
    category: "medicine",
    unit: "caps",
    reorderLevel: 50,
    storageCondition: "room-temperature",
    supplier: "City Health Office",
    batch: { batchNumber: "AMX2024087", quantity: 30, expiryInDays: 180, receivedDaysAgo: 45 },
  },
  {
    name: "Tetanus Vaccine",
    specification: "0.5 mL (Adult)",
    genericName: "Tetanus Toxoid",
    category: "vaccine",
    unit: "vials",
    reorderLevel: 20,
    storageCondition: "refrigerated",
    supplier: "DOH Regional Office V",
    batch: { batchNumber: "TT2024082", quantity: 12, expiryInDays: 43, receivedDaysAgo: 24 },
  },
  {
    name: "Syringe 3mL",
    specification: "Disposable",
    category: "supply",
    unit: "pcs",
    reorderLevel: 100,
    storageCondition: "dry-storage",
    supplier: "City Health Office",
    batch: { batchNumber: "SYR2024095", quantity: 500, expiryInDays: 840, receivedDaysAgo: 20 },
  },
  {
    name: "BP Monitor",
    specification: "Digital",
    category: "equipment",
    unit: "units",
    reorderLevel: 2,
    storageCondition: "room-temperature",
    supplier: "Barangay LGU",
    // Equipment does not perish, so its batch carries no expiry date at all.
    batch: { batchNumber: "BPM2024071", quantity: 5, expiryInDays: null, receivedDaysAgo: 200 },
  },
  {
    name: "Prenatal Vitamins",
    specification: "Tablet",
    genericName: "Ferrous Sulfate + Folic Acid",
    category: "medicine",
    unit: "bottles",
    reorderLevel: 30,
    storageCondition: "room-temperature",
    supplier: "DOH Regional Office V",
    batch: { batchNumber: "PNV2024089", quantity: 18, expiryInDays: 130, receivedDaysAgo: 60 },
  },
  {
    name: "Alcohol 70%",
    specification: "500 mL",
    category: "supply",
    unit: "bottles",
    reorderLevel: 10,
    storageCondition: "dry-storage",
    supplier: "City Health Office",
    // Received and fully consumed, so the item reads Out of Stock with a real
    // ledger behind the zero rather than an item that was never stocked.
    batch: { batchNumber: "ALC2024090", quantity: 24, expiryInDays: 660, receivedDaysAgo: 90, releaseAll: true },
  },
  {
    name: "Gloves (Nitrile)",
    specification: "Box (100 pcs)",
    category: "supply",
    unit: "boxes",
    reorderLevel: 50,
    storageCondition: "dry-storage",
    supplier: "City Health Office",
    batch: { batchNumber: "GLV2024088", quantity: 200, expiryInDays: 450, receivedDaysAgo: 15 },
  },
];

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
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    supplierIds.set(supplier.name, record._id);
  }

  // Every movement needs an actor; the seeded administrator stands in for the
  // staff member who would have received the delivery.
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
