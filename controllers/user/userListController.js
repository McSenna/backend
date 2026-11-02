"use strict";

const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const { readPolicy } = require("../../services/residentWebAccess");
const { countMasterResidents } = require("../../services/masterList/masterResidentRows");
const asyncHandler = require("../../utils/asyncHandler");
const { badRequest, notFound } = require("../../utils/AppError");
const { HTTP_STATUS, ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { serializeUserRow, serializeUserDetail } = require("../../services/userDirectory/userPresenter");
const { SEGMENTS } = require("../../services/userDirectory/accountLifecycle");
const {
  SORTS,
  NAME_COLLATION,
  effectiveStatusStage,
  resolveListParams,
  buildListMatch,
} = require("../../services/userDirectory/userListQuery");

const OPEN_DECISIONS = ["pending", "rejected"];

// Only requested and rejected rows are decided through ID review.
const verificationStages = [
  {
    $lookup: {
      from: ResidentVerification.collection.name,
      let: { accountId: "$_id", accountStatus: "$effectiveStatus" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$user", "$$accountId"] },
                { $in: ["$$accountStatus", OPEN_DECISIONS] },
                { $in: ["$verificationStatus", OPEN_DECISIONS] },
              ],
            },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: "openVerification",
    },
  },
  { $addFields: { verificationId: { $first: "$openVerification._id" } } },
  { $project: { password: 0, effectiveStatus: 0, openVerification: 0 } },
];

/** GET /users: one filtered, sorted page. There is no unpaged form. */
exports.getAllUsers = asyncHandler(async (req, res) => {
  const params = resolveListParams(req.query);

  const [result] = await User.aggregate([
    effectiveStatusStage,
    { $match: buildListMatch(params) },
    {
      $facet: {
        total: [{ $count: "value" }],
        rows: [
          { $sort: SORTS[params.sort] },
          { $skip: (params.page - 1) * params.perPage },
          { $limit: params.perPage },
          ...verificationStages,
        ],
      },
    },
  ]).collation(NAME_COLLATION);

  const policy = await readPolicy();
  const total = result.total[0] ? result.total[0].value : 0;
  res.set("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    users: result.rows.map((user) => serializeUserRow(user, policy)),
    pagination: {
      page: params.page,
      perPage: params.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.perPage)),
    },
  });
});

/** GET /users/summary: the numbers on the overview cards and segments. */
exports.getUserSummary = asyncHandler(async (_req, res) => {
  const [groups, masterlist] = await Promise.all([
    User.aggregate([
      effectiveStatusStage,
      { $group: { _id: { status: "$effectiveStatus", resident: { $eq: ["$role", "resident"] } }, count: { $sum: 1 } } },
    ]),
    countMasterResidents(),
  ]);

  const sumWhere = (test) => groups.filter((group) => test(group._id)).reduce((sum, group) => sum + group.count, 0);
  const inSegment = (segment) => sumWhere((id) => SEGMENTS[segment].includes(id.status));
  const total = sumWhere(() => true);
  const active = inSegment("active");

  res.set("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    summary: {
      total,
      staff: sumWhere((id) => !id.resident),
      residents: sumWhere((id) => id.resident),
      active,
      approved: sumWhere((id) => id.status === "approved"),
      requests: inSegment("requests"),
      rejected: inSegment("rejected"),
      deactivated: inSegment("deactivated"),
      activePercent: total === 0 ? 0 : Math.round((active / total) * 100),
      masterlist,
    },
  });
});

/** GET /users/:id: the View drawer and Edit dialog. */
exports.getUserById = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    throw badRequest("A valid user id is required.", ERROR_CODES.VALIDATION_ERROR);
  }
  const user = await User.findById(req.params.id).select("-password").lean();
  if (!user) throw notFound("User not found.", ERROR_CODES.USER_NOT_FOUND);
  res.set("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).json({ success: true, user: serializeUserDetail(user, await readPolicy()) });
});
