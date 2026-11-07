"use strict";
const User = require("../../models/User");
const logger = require("../../utils/logger");

const recordLoginActivity = async (user) => {
  const loginAt = new Date();
  try {
    // The conditional runs against the current row, so a concurrent suspension
    // cannot be overwritten by promoting the stale account read during login.
    await User.updateOne({ _id: user._id }, [{ $set: {
      lastLogin: loginAt,
      status: { $cond: [
        { $eq: ["$status", "approved"] }, "active", { $ifNull: ["$status", "$$REMOVE"] },
      ] },
    } }], { updatePipeline: true, maxTimeMS: 2000 });
    user.lastLogin = loginAt;
    if (user.status === "approved") user.status = "active";
  } catch (error) {
    logger.warn("Could not record login activity", { operation: "auth.login.activity", errorName: error?.name });
  }
};
module.exports = { recordLoginActivity };
