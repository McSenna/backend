"use strict";

const mongoose = require("mongoose");

const InventoryItem = require("../models/InventoryItem");
const InventoryBatch = require("../models/InventoryBatch");
const InventoryTransaction = require("../models/InventoryTransaction");
const { INCREASING_TYPES } = require("../models/InventoryTransaction");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { badRequest, conflict, notFound } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const logger = require("../utils/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Expiry bands, in days remaining.
 *
 * Configurable through the environment because a barangay health centre and a
 * city health office run different lead times; the defaults are the DOH-style
 * 30/90 day windows the UI is specified against.
 */
const EXPIRY_THRESHOLDS = {
  urgent: Number(process.env.INVENTORY_URGENT_EXPIRY_DAYS) || 30,
  soon: Number(process.env.INVENTORY_EXPIRING_SOON_DAYS) || 90,
};

/** Roles that receive low-stock and expiry notifications. */
const ALERT_ROLES = ["admin"];

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Stock status is derived, never stored: an operator choosing "In Stock" by
 * hand is exactly how a stock figure and its label drift apart.
 */
function computeStockStatus(currentStock, reorderLevel) {
  const stock = Number(currentStock) || 0;
  const reorder = Number(reorderLevel) || 0;
  if (stock <= 0) return "out-of-stock";
  if (stock <= reorder) return "low-stock";
  return "in-stock";
}

/**
 * Expiry status for one date. `none` is a real answer, not a missing one —
 * equipment genuinely does not expire, and the filter treats it as its own
 * bucket rather than hiding those rows.
 */
function computeExpiryStatus(expiryDate, now = new Date()) {
  if (!expiryDate) return "none";

  const expiry = startOfDay(expiryDate).getTime();
  const today = startOfDay(now).getTime();

  if (expiry < today) return "expired";

  const daysRemaining = Math.round((expiry - today) / DAY_MS);
  if (daysRemaining <= EXPIRY_THRESHOLDS.urgent) return "urgent";
  if (daysRemaining <= EXPIRY_THRESHOLDS.soon) return "expiring-soon";
  return "normal";
}

function daysUntil(expiryDate, now = new Date()) {
  if (!expiryDate) return null;
  return Math.round((startOfDay(expiryDate).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

/**
 * Rebuilds an item's cached stock figures from its batches.
 *
 * The one writer allowed to set `currentStock` outside a guarded movement:
 * every stock path calls it after touching batches, so the cache is derived
 * from the batch rows rather than accumulated independently of them.
 */
async function recalculateItemStock(itemId, session = null) {
  const now = new Date();

  const query = InventoryBatch.find({ item: itemId, status: { $in: ["active", "expired"] } })
    .select("quantityRemaining expiryDate status")
    .lean();
  if (session) query.session(session);
  const batches = await query;

  let currentStock = 0;
  let nearestExpiry = null;

  for (const batch of batches) {
    const isExpired = batch.expiryDate && startOfDay(batch.expiryDate) < startOfDay(now);
    // Expired stock is physically present but is not available to release, so
    // it is excluded from the figure every availability check reads.
    if (isExpired || batch.status !== "active") continue;

    currentStock += batch.quantityRemaining;

    if (batch.expiryDate && batch.quantityRemaining > 0) {
      if (!nearestExpiry || batch.expiryDate < nearestExpiry) nearestExpiry = batch.expiryDate;
    }
  }

  const update = InventoryItem.findByIdAndUpdate(
    itemId,
    { currentStock, nearestExpiry },
    { new: true }
  );
  if (session) update.session(session);
  return update;
}

/**
 * Marks lapsed batches expired so they leave the available pool.
 *
 * Run before any read or release for an item rather than on a nightly job: a
 * batch that expired overnight must not be releasable simply because no
 * scheduled task has run yet.
 */
async function expireLapsedBatches(itemId = null, session = null) {
  const filter = {
    status: "active",
    expiryDate: { $ne: null, $lt: startOfDay(new Date()) },
  };
  if (itemId) filter.item = itemId;

  const query = InventoryBatch.updateMany(filter, { status: "expired" });
  if (session) query.session(session);
  return query;
}

/**
 * FEFO — First Expired, First Out.
 *
 * Returns the batches to draw `quantity` from, nearest expiry first, skipping
 * anything already expired. Never returns a partial allocation: if the active
 * batches cannot cover the request the caller gets a conflict, because a
 * half-filled release would leave the ledger describing a dispense that did
 * not happen.
 */
function planFefoAllocation(batches, quantity) {
  let remaining = quantity;
  const plan = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    if (batch.quantityRemaining <= 0) continue;

    const take = Math.min(batch.quantityRemaining, remaining);
    plan.push({ batch, quantity: take });
    remaining -= take;
  }

  return { plan, shortfall: remaining };
}

/**
 * Runs `fn` inside a transaction where the deployment supports one.
 *
 * Mongo only offers multi-document transactions on a replica set, and a single
 * mongod in development is not one. Rather than making the module unusable
 * there, the fallback runs the same steps without a session — the per-document
 * guards below (`quantityRemaining: { $gte: n }`) are what actually prevent
 * negative stock, so correctness of the stock figure does not depend on the
 * transaction; the transaction adds all-or-nothing grouping on top.
 */
async function runInTransaction(fn) {
  let session = null;

  try {
    session = await mongoose.startSession();
  } catch {
    return fn(null);
  }

  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (error) {
    const unsupported =
      error?.code === 20 ||
      /Transaction numbers are only allowed|replica set|not supported/i.test(error?.message || "");

    if (unsupported) {
      logger.warn("Inventory transaction unsupported on this deployment; applying guarded writes");
      return fn(null);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => {});
  }
}

/**
 * Receives stock into a batch.
 *
 * A repeat receipt of a lot number already on file tops that lot up rather than
 * creating a second row for the same physical box — the unique index on
 * (item, batchNumber) makes that the only correct outcome.
 */
async function stockIn({ item, payload, actor }) {
  const quantity = Math.trunc(Number(payload.quantity));

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw badRequest("Quantity must be a whole number greater than zero.");
  }

  const batchNumber = String(payload.batchNumber || "").trim();
  if (!batchNumber) throw badRequest("Batch / Lot number is required.");

  const expiryDate = payload.expiryDate ? new Date(payload.expiryDate) : null;
  if (payload.expiryDate && Number.isNaN(expiryDate.getTime())) {
    throw badRequest("Expiry date is not a valid date.");
  }
  if (expiryDate && startOfDay(expiryDate) < startOfDay(new Date())) {
    throw badRequest("Expiry date cannot be in the past. Expired stock must not be received.");
  }

  const receivedDate = payload.receivedDate ? new Date(payload.receivedDate) : new Date();
  if (Number.isNaN(receivedDate.getTime())) {
    throw badRequest("Date received is not a valid date.");
  }

  return runInTransaction(async (session) => {
    const previousStock = item.currentStock;

    const batch = await InventoryBatch.findOneAndUpdate(
      { item: item._id, batchNumber },
      {
        $inc: { quantityReceived: quantity, quantityRemaining: quantity },
        // `item` and `batchNumber` come from the upsert filter; repeating them
        // here would be a conflicting update on the same paths.
        $setOnInsert: {
          receivedDate,
          receivedBy: actor.userId,
        },
        $set: {
          status: "active",
          ...(expiryDate ? { expiryDate } : {}),
          ...(payload.supplier ? { supplier: payload.supplier } : {}),
          ...(payload.storageCondition ? { storageCondition: payload.storageCondition } : {}),
          ...(payload.remarks ? { remarks: String(payload.remarks).slice(0, 500) } : {}),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );

    const updatedItem = await recalculateItemStock(item._id, session);

    await InventoryItem.findByIdAndUpdate(
      item._id,
      { lastRestockedAt: receivedDate, updatedBy: actor.userId },
      { session }
    );

    const [transaction] = await InventoryTransaction.create(
      [
        {
          item: item._id,
          batch: batch._id,
          batchNumber,
          type: "STOCK_IN",
          quantity,
          previousStock,
          newStock: updatedItem.currentStock,
          reason: String(payload.reason || "Stock received").slice(0, 300),
          source: String(payload.source || "").slice(0, 200),
          notes: String(payload.remarks || "").slice(0, 1000),
          performedBy: actor.userId,
          performedByRole: actor.role,
        },
      ],
      session ? { session } : {}
    );

    return { batch, item: updatedItem, transaction };
  });
}

/**
 * Releases stock, drawing from batches FEFO.
 *
 * Each decrement is conditional on the batch still holding what the plan
 * assumed (`quantityRemaining: { $gte: take }`). Two releases racing for the
 * last units therefore cannot both succeed: the loser's conditional update
 * matches nothing and the whole release is rejected, so stock never goes
 * negative even without a replica set underneath.
 */
async function stockOut({ item, payload, actor }) {
  const quantity = Math.trunc(Number(payload.quantity));

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw badRequest("Quantity must be a whole number greater than zero.");
  }
  if (!String(payload.reason || "").trim()) {
    throw badRequest("A reason for the release is required.");
  }

  await expireLapsedBatches(item._id);
  const refreshed = await recalculateItemStock(item._id);

  if (refreshed.currentStock <= 0) {
    throw conflict("This item is out of stock and cannot be released.", ERROR_CODES.CONFLICT);
  }
  if (quantity > refreshed.currentStock) {
    throw conflict(
      `Only ${refreshed.currentStock} ${refreshed.unit} available. Reduce the quantity to release.`,
      ERROR_CODES.CONFLICT
    );
  }

  return runInTransaction(async (session) => {
    const previousStock = refreshed.currentStock;

    // FEFO, and expired lots are excluded by the status filter rather than by
    // the caller choosing a batch — a client cannot ask for an expired lot.
    const batchQuery = InventoryBatch.find({
      item: item._id,
      status: "active",
      quantityRemaining: { $gt: 0 },
      $or: [{ expiryDate: null }, { expiryDate: { $gte: startOfDay(new Date()) } }],
    });
    if (session) batchQuery.session(session);

    // Ordered here rather than in the query: Mongo sorts null *before* dates,
    // so a batch with no expiry would be drawn first — the opposite of FEFO.
    // Dated lots leave first, earliest expiry leading; undated stock is last.
    const batches = (await batchQuery).sort((a, b) => {
      if (a.expiryDate && b.expiryDate) {
        const diff = a.expiryDate - b.expiryDate;
        if (diff !== 0) return diff;
      } else if (a.expiryDate) {
        return -1;
      } else if (b.expiryDate) {
        return 1;
      }
      return new Date(a.receivedDate || 0) - new Date(b.receivedDate || 0);
    });
    const { plan, shortfall } = planFefoAllocation(batches, quantity);

    if (shortfall > 0) {
      throw conflict(
        "Not enough unexpired stock is available to cover this release.",
        ERROR_CODES.CONFLICT
      );
    }

    const transactions = [];
    let runningStock = previousStock;

    for (const step of plan) {
      const applied = await InventoryBatch.findOneAndUpdate(
        { _id: step.batch._id, quantityRemaining: { $gte: step.quantity }, status: "active" },
        { $inc: { quantityRemaining: -step.quantity } },
        { new: true, session }
      );

      // Someone else took these units between the plan and the write.
      if (!applied) {
        throw conflict(
          "This stock was just released by someone else. Please review the item and try again.",
          ERROR_CODES.CONFLICT
        );
      }

      if (applied.quantityRemaining === 0) {
        await InventoryBatch.findByIdAndUpdate(applied._id, { status: "depleted" }, { session });
      }

      const newStock = runningStock - step.quantity;

      transactions.push({
        item: item._id,
        batch: applied._id,
        batchNumber: applied.batchNumber,
        type: payload.type || "STOCK_OUT",
        quantity: step.quantity,
        previousStock: runningStock,
        newStock,
        reason: String(payload.reason).slice(0, 300),
        recipient: String(payload.recipient || "").slice(0, 200),
        notes: String(payload.remarks || "").slice(0, 1000),
        performedBy: actor.userId,
        performedByRole: actor.role,
        relatedPatient: payload.relatedPatient || null,
        relatedAppointment: payload.relatedAppointment || null,
      });

      runningStock = newStock;
    }

    const created = await InventoryTransaction.create(transactions, session ? { session } : {});
    const updatedItem = await recalculateItemStock(item._id, session);

    return { item: updatedItem, transactions: created, batchesUsed: plan.length };
  });
}

/**
 * Fans a stock alert out to the roles that can act on it.
 *
 * Failures are swallowed: a notification that cannot be written must not roll
 * back a release that physically happened at the counter.
 */
async function notifyStockAlert(item, kind) {
  try {
    const recipients = await User.find({ role: { $in: ALERT_ROLES }, verified: true })
      .select("_id")
      .lean();
    if (!recipients.length) return;

    const label = `${item.name}${item.specification ? ` (${item.specification})` : ""}`;

    const content =
      kind === "out-of-stock"
        ? {
            type: "inventory_out_of_stock",
            title: "Out of Stock",
            body: `${label} is out of stock. Current stock: 0 ${item.unit}.`,
            tone: "warning",
          }
        : {
            type: "inventory_low_stock",
            title: "Low Stock Alert",
            body: `${label} is below its reorder level. Current stock: ${item.currentStock} ${item.unit}, reorder level: ${item.reorderLevel} ${item.unit}.`,
            tone: "warning",
          };

    await Notification.insertMany(
      recipients.map((user) => ({ recipient: user._id, ...content }))
    );
  } catch (error) {
    logger.warn("Failed to write inventory stock alert", { errorName: error?.name });
  }
}

async function notifyExpiryAlert(item, batch) {
  try {
    const recipients = await User.find({ role: { $in: ALERT_ROLES }, verified: true })
      .select("_id")
      .lean();
    if (!recipients.length) return;

    const remaining = daysUntil(batch.expiryDate);
    const label = `${item.name}${item.specification ? ` (${item.specification})` : ""}`;

    await Notification.insertMany(
      recipients.map((user) => ({
        recipient: user._id,
        type: "inventory_expiring",
        title: "Stock Expiring Soon",
        body: `${label} — batch ${batch.batchNumber} expires in ${remaining} day${remaining === 1 ? "" : "s"}. ${batch.quantityRemaining} ${item.unit} remaining.`,
        tone: "warning",
      }))
    );
  } catch (error) {
    logger.warn("Failed to write inventory expiry alert", { errorName: error?.name });
  }
}

/** Raises the alerts a movement has just made true. Never throws. */
async function evaluateStockAlerts(item) {
  if (!item) return;
  const status = computeStockStatus(item.currentStock, item.reorderLevel);
  if (status === "out-of-stock") await notifyStockAlert(item, "out-of-stock");
  else if (status === "low-stock") await notifyStockAlert(item, "low-stock");
}

async function getItemOrThrow(itemId, { includeInactive = false } = {}) {
  const filter = { _id: itemId };
  if (!includeInactive) filter.isActive = true;

  const item = await InventoryItem.findOne(filter);
  if (!item) throw notFound("Inventory item not found.");
  return item;
}

module.exports = {
  EXPIRY_THRESHOLDS,
  computeStockStatus,
  computeExpiryStatus,
  daysUntil,
  startOfDay,
  recalculateItemStock,
  expireLapsedBatches,
  planFefoAllocation,
  runInTransaction,
  stockIn,
  stockOut,
  evaluateStockAlerts,
  notifyExpiryAlert,
  getItemOrThrow,
  INCREASING_TYPES,
};
