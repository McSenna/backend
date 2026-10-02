"use strict";

const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const { serializeUser } = require("../../services/userDirectory/userPresenter");
const {
  STATUS_GROUPS,
  LISTED_STATUSES,
  SORTS,
  effectiveStatusStage,
  resolveListParams,
  buildListMatch,
} = require("../../services/userDirectory/userListQuery");

// Case-insensitive, so "ana" and "Ana" sort together under "Name, A to Z".
const NAME_COLLATION = { locale: "en", strength: 2 };

const listAllUsers = async (res) => {
  const users = await User.find({}).select("-password").sort({ createdAt: -1 }).lean();
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Users loaded successfully.",
    count: users.length,
    users: users.map(serializeUser),
  });
};

/**
 * GET /users. With `page`, one filtered, sorted page for the admin Users
 * screen; without it, every account (the older contract, kept for callers
 * that still expect it).
 */
exports.getAllUsers = asyncHandler(async (req, res) => {
  if (req.query.page === undefined) return listAllUsers(res);

  const params = resolveListParams(req.query);
  const match = buildListMatch(params);

  const [result] = await User.aggregate([
    effectiveStatusStage,
    { $match: match },
    {
      $facet: {
        total: [{ $count: "value" }],
        rows: [
          { $sort: SORTS[params.sort] },
          { $skip: (params.page - 1) * params.pageSize },
          { $limit: params.pageSize },
          // Aggregation ignores the schema's `select: false`, so drop the hash here.
          { $project: { password: 0, effectiveStatus: 0 } },
        ],
      },
    },
  ]).collation(NAME_COLLATION);

  const total = result.total[0] ? result.total[0].value : 0;
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    users: result.rows.map(serializeUser),
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    },
  });
});

const startOfMonth = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);

/** GET /users/summary: the numbers on the overview cards and tab badges. */
exports.getUserSummary = asyncHandler(async (_req, res) => {
  const [groups, requestCounts] = await Promise.all([
    User.aggregate([
      effectiveStatusStage,
      { $match: { effectiveStatus: { $in: LISTED_STATUSES } } },
      {
        $group: {
          _id: { status: "$effectiveStatus", resident: { $eq: ["$role", "resident"] } },
          count: { $sum: 1 },
          addedThisMonth: { $sum: { $cond: [{ $gte: ["$createdAt", startOfMonth()] }, 1, 0] } },
        },
      },
    ]),
    ResidentVerification.aggregate([
      { $match: { verificationStatus: { $in: ["pending", "rejected"] } } },
      { $group: { _id: "$verificationStatus", count: { $sum: 1 } } },
    ]),
  ]);

  const sumWhere = (test, field = "count") =>
    groups.filter((group) => test(group._id)).reduce((sum, group) => sum + group[field], 0);
  const requestCount = (status) => requestCounts.find((row) => row._id === status)?.count ?? 0;

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    summary: {
      total: sumWhere(() => true),
      staff: sumWhere((id) => !id.resident),
      residents: sumWhere((id) => id.resident),
      active: sumWhere((id) => STATUS_GROUPS.active.includes(id.status)),
      approved: sumWhere((id) => STATUS_GROUPS.approved.includes(id.status)),
      deactivated: sumWhere((id) => STATUS_GROUPS.deactivated.includes(id.status)),
      addedThisMonth: sumWhere(() => true, "addedThisMonth"),
      pendingRequests: requestCount("pending"),
      rejectedRequests: requestCount("rejected"),
    },
  });
});
