"use strict";

const { INVENTORY_CATEGORIES } = require("../../models/InventoryItem");
const { MOVEMENT_GROUPS } = require("../../config/inventoryMovements");
const { badRequest } = require("../../utils/AppError");
const { escapeRegex } = require("../../utils/escapeRegex");
const { isValidObjectId } = require("../../utils/objectId");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TERM_LENGTH = 100;

// _id breaks ties, so rows written in the same millisecond keep a stable order across pages.
const MOVEMENT_SORTS = {
  date_desc: { createdAt: -1, _id: -1 },
  date_asc: { createdAt: 1, _id: 1 },
  quantity_desc: { quantity: -1, createdAt: -1, _id: -1 },
  quantity_asc: { quantity: 1, createdAt: -1, _id: -1 },
  item_asc: { itemName: 1, createdAt: -1, _id: -1 },
};

const term = (value) => String(value ?? "").trim().slice(0, MAX_TERM_LENGTH);

// A date in the filter means that day at the health center, not a UTC day.
const readDay = (value, edge, label) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = DATE_ONLY.test(raw) ? new Date(`${raw}T${edge}+08:00`) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${label} must be a date like 2026-11-09.`);
  return parsed;
};

const readOption = (value, allowed, label) => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "all") return "";
  if (!allowed.includes(raw)) throw badRequest(`${label} is not one of the available options.`);
  return raw;
};

const readMovementQuery = (query = {}) => {
  const from = readDay(query.from, "00:00:00.000", "The start date");
  const to = readDay(query.to, "23:59:59.999", "The end date");
  if (from && to && from > to) throw badRequest("The start date must be on or before the end date.");

  const performedBy = term(query.performedBy);
  if (performedBy && !isValidObjectId(performedBy)) throw badRequest("Choose a staff member from the list.");

  return {
    search: term(query.search),
    group: readOption(query.type, Object.keys(MOVEMENT_GROUPS), "Movement type"),
    category: readOption(query.category, INVENTORY_CATEGORIES, "Category"),
    from,
    to,
    destination: term(query.destination),
    recipient: term(query.recipient),
    performedBy,
    sort: MOVEMENT_SORTS[String(query.sort)] ? String(query.sort) : "date_desc",
  };
};

const contains = (value) => new RegExp(escapeRegex(value), "i");
const anyField = (fields, value) => ({ $or: fields.map((field) => ({ [field]: contains(value) })) });

const buildMovementFilter = ({ search, group, category, from, to, destination, recipient, performedBy }) => {
  const filter = {};
  if (group) filter.type = { $in: MOVEMENT_GROUPS[group] };
  if (category) filter.itemCategory = category;
  if (performedBy) filter.performedBy = performedBy;
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const clauses = [];
  if (search) clauses.push(anyField(["reference", "itemName", "itemCode", "itemSpecification", "batchNumber"], search));
  if (destination) clauses.push(anyField(["destinationName", "destinationDepartment", "destinationLocation"], destination));
  if (recipient) clauses.push(anyField(["recipient", "recipientDepartment"], recipient));
  if (clauses.length > 0) filter.$and = clauses;

  return filter;
};

module.exports = { MOVEMENT_SORTS, readMovementQuery, buildMovementFilter };
