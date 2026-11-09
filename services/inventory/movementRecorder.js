"use strict";

const mongoose = require("mongoose");
const InventoryItem = require("../../models/InventoryItem");
const InventoryTransaction = require("../../models/InventoryTransaction");
const User = require("../../models/User");
const { SYSTEM_ACTOR_NAME } = require("../../config/inventoryMovements");
const { badRequest, conflict, notFound } = require("../../utils/AppError");

const { movementReference } = InventoryTransaction;
const { itemCodeOf } = InventoryItem;

const OPERATION_ID = /^[A-Za-z0-9_-]{8,64}$/;

const SYSTEM_ACTOR = Object.freeze({ system: true, role: "system" });

// Older app builds send no id, so it stays optional.
const readOperationId = (payload) => {
  const raw = payload?.operationId;
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !OPERATION_ID.test(raw)) {
    throw badRequest("The request reference is not valid. Please reopen the form and try again.");
  }
  return raw;
};

// The first write of a stock transaction. A second movement on the same item conflicts
// here and is retried by withTransaction, so before/after counts always chain.
const lockItem = async (itemId, session) => {
  const item = await InventoryItem.findOneAndUpdate(
    { _id: itemId },
    { $inc: { movementSeq: 1 } },
    { returnDocument: "after", session, timestamps: false }
  );
  if (!item) throw notFound("Inventory item not found.");
  return item;
};

const findReplay = async ({ itemId, operationId, session }) => {
  if (!operationId) return null;
  const rows = await InventoryTransaction.find({ operationId }).sort({ operationLine: 1 }).session(session);
  if (rows.length === 0) return null;
  if (String(rows[0].item) !== String(itemId)) {
    throw conflict("This request was already used for another item. Please reopen the form and try again.");
  }
  return rows;
};

const actorName = async (actor, session) => {
  if (actor.system) return SYSTEM_ACTOR_NAME;
  const user = await User.findById(actor.userId).select("fullname").session(session).lean();
  return user?.fullname || "";
};

const buildRow = ({ item, line, index, actor, operationId, performedByName }) => {
  const _id = new mongoose.Types.ObjectId();
  const lineOperationId = line.operationId ?? operationId;

  return {
    ...line,
    _id,
    reference: movementReference(_id),
    item: item._id,
    itemName: item.name,
    itemSpecification: item.specification || "",
    itemCode: item.itemCode || itemCodeOf(item._id),
    itemCategory: item.category,
    itemUnit: item.unit,
    performedBy: actor.system ? undefined : actor.userId,
    performedByName,
    performedByRole: actor.role,
    recordedBySystem: Boolean(actor.system),
    operationId: lineOperationId ?? undefined,
    operationLine: lineOperationId ? (line.operationId ? 0 : index) : undefined,
  };
};

// The only place a movement is written. Callers pass their open transaction, so the
// stock change and its record commit together or not at all.
const recordMovements = async ({ item, lines, actor, operationId = null, session }) => {
  const performedByName = await actorName(actor, session);
  const rows = lines.map((line, index) => buildRow({ item, line, index, actor, operationId, performedByName }));
  return InventoryTransaction.create(rows, { session, ordered: true });
};

module.exports = { SYSTEM_ACTOR, readOperationId, lockItem, findReplay, recordMovements };
