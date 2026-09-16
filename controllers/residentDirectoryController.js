"use strict";

const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { HTTP_STATUS } = require("../utils/errorCodes");
const {
  RESIDENT_FIELDS,
  SORTS,
  buildResidentQuery,
  readListOptions,
} = require("../services/residentDirectory/residentQuery");
const {
  serializeResident,
  summarizeResidents,
} = require("../services/residentDirectory/residentPresenter");

exports.getResidents = asyncHandler(async (req, res) => {
  const { page, pageSize, sortKey, status, search } = readListOptions(req.query);
  const query = buildResidentQuery({ status, search });

  const [total, summary] = await Promise.all([
    User.countDocuments(query),
    summarizeResidents(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const residents = await User.find(query)
    .select(RESIDENT_FIELDS)
    .sort(SORTS[sortKey])
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .lean();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Residents loaded successfully.",
    residents: residents.map(serializeResident),
    page: safePage,
    pageSize,
    total,
    totalPages,
    summary,
  });
});
