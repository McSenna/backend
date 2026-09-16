"use strict";

const User = require("../../models/User");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const applyDateRange = (query, dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return;

  query.createdAt = {};
  if (dateFrom) {
    const from = new Date(dateFrom);
    if (!isNaN(from.getTime())) query.createdAt.$gte = from;
  }
  if (dateTo) {
    const to = new Date(dateTo);
    if (!isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      query.createdAt.$lte = to;
    }
  }
};

const applySearch = async (query, search) => {
  const trimmedSearch = String(search).trim();
  if (!trimmedSearch) return;

  const searchRegex = new RegExp(escapeRegex(trimmedSearch), "i");
  const matchedUsers = await User.find({
    role: "resident",
    $or: [{ fullname: searchRegex }, { email: searchRegex }, { phone: searchRegex }],
  })
    .select("_id")
    .lean();

  query.user = { $in: matchedUsers.map((user) => user._id) };
};

const buildVerificationQuery = async ({ status, search, idType, dateFrom, dateTo }) => {
  const query = {};

  const normalizedStatus = String(status).trim().toLowerCase();
  if (normalizedStatus && normalizedStatus !== "all") {
    query.verificationStatus = normalizedStatus;
  }

  if (idType && String(idType).trim()) {
    query.idType = String(idType).trim().toLowerCase();
  }

  applyDateRange(query, dateFrom, dateTo);
  await applySearch(query, search);

  return query;
};

const resolvePaging = ({ page, limit }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
};

module.exports = { buildVerificationQuery, resolvePaging };
