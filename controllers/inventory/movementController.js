"use strict";

const InventoryTransaction = require("../../models/InventoryTransaction");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { notFound } = require("../../utils/AppError");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { expireLapsedBatches } = require("../../services/inventoryService");
const { MOVEMENT_SORTS, buildMovementFilter, readMovementQuery } = require("../../services/inventory/movementQuery");
const { loadMovementLinks, serializeMovement, emptyLink } = require("../../services/inventory/movementPresenter");
const { countByType, reconcileStock, summarizeMovements } = require("../../services/inventory/movementSummary");
const { pagingMeta, resolvePaging } = require("./inventory.access");

const withLegacyNames = (query) => query.populate("item", "name specification category unit").populate("performedBy", "fullname role");

const getMovements = asyncHandler(async (req, res) => {
  const params = readMovementQuery(req.query);
  const filter = buildMovementFilter(params);
  const { pageNumber, pageLimit, skip } = resolvePaging(req.query, 10);

  const [rows, total] = await Promise.all([
    withLegacyNames(InventoryTransaction.find(filter).sort(MOVEMENT_SORTS[params.sort]).skip(skip).limit(pageLimit)).lean(),
    InventoryTransaction.countDocuments(filter),
  ]);
  const links = await loadMovementLinks(rows.map((row) => row._id));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory history loaded successfully.",
    ...pagingMeta(total, pageNumber, pageLimit),
    movements: rows.map((row) => serializeMovement(row, links.get(String(row._id)) ?? emptyLink)),
  });
});

const getMovementSummary = asyncHandler(async (req, res) => {
  // Records today's lapsed lots first, so the check below compares like with like.
  await expireLapsedBatches();

  const params = readMovementQuery(req.query);
  const filter = buildMovementFilter(params);
  // The segments are the type filter, so their counts apply every other filter but that one.
  const [summary, typeCounts, reconciliation] = await Promise.all([
    summarizeMovements(filter),
    countByType(buildMovementFilter({ ...params, group: "" })),
    reconcileStock(),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory history summary loaded successfully.",
    summary,
    typeCounts,
    reconciliation,
  });
});

// Only staff who have actually moved stock appear, by the name recorded at the time.
const getMovementFilters = asyncHandler(async (_req, res) => {
  const people = await InventoryTransaction.aggregate([
    { $match: { performedBy: { $ne: null }, performedByName: { $nin: ["", null] } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$performedBy", name: { $first: "$performedByName" }, role: { $first: "$performedByRole" } } },
    { $sort: { name: 1 } },
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory history filters loaded successfully.",
    personnel: people.map((person) => ({ _id: String(person._id), name: person.name, role: person.role || "" })),
  });
});

const getMovement = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "inventory movement");
  const row = await withLegacyNames(InventoryTransaction.findById(id)).lean();
  if (!row) throw notFound("That inventory movement could not be found.");

  const [links, related] = await Promise.all([
    loadMovementLinks([row._id]),
    row.relatedTransaction ? InventoryTransaction.findById(row.relatedTransaction).select("reference").lean() : null,
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Inventory movement loaded successfully.",
    movement: {
      ...serializeMovement(row, links.get(String(row._id)) ?? emptyLink),
      relatedReference: related?.reference || "",
    },
  });
});

module.exports = { getMovements, getMovementSummary, getMovementFilters, getMovement };
