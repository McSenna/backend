"use strict";

const ResidentVerification = require("../../models/ResidentVerification");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS } = require("../../utils/errorCodes");
const {
  buildVerificationQuery,
  resolvePaging,
} = require("../../services/userRequest/verificationQuery");
const {
  LIST_USER_FIELDS,
  toListRow,
  tallyCounts,
} = require("../../services/userRequest/verificationPresenter");

exports.getUserRequests = asyncHandler(async (req, res) => {
  const {
    status = "pending",
    search = "",
    idType = "",
    dateFrom = "",
    dateTo = "",
  } = req.query;

  const { pageNum, limitNum, skip } = resolvePaging(req.query);
  const query = await buildVerificationQuery({ status, search, idType, dateFrom, dateTo });

  const [countsAggregation, totalMatching, verifications] = await Promise.all([
    ResidentVerification.aggregate([
      { $group: { _id: "$verificationStatus", count: { $sum: 1 } } },
    ]),
    ResidentVerification.countDocuments(query),
    ResidentVerification.find(query)
      .populate("user", LIST_USER_FIELDS)
      .populate("verifiedBy", "fullname email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    requests: verifications.map(toListRow),
    counts: tallyCounts(countsAggregation),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalMatching,
      totalPages: Math.ceil(totalMatching / limitNum) || 1,
    },
  });
});
