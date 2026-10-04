"use strict";

const ResidentVerification = require("../../models/ResidentVerification");
const { LIST_USER_FIELDS, toListRow } = require("../../services/userRequest/verificationPresenter");
const { broadcast } = require("../broadcast");
const { adminRoom } = require("../rooms");
const { splitChanges } = require("./shared");

const READERS = [adminRoom()];

// Same populate as GET /admin/user-requests, so the row matches the listed one.
const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    const requests = await ResidentVerification.find({ _id: { $in: liveIds } })
      .populate("user", LIST_USER_FIELDS)
      .populate("verifiedBy", "fullname email")
      .lean();
    for (const request of requests) {
      broadcast("userRequest", actionOf(request._id), toListRow(request), READERS);
    }
  }

  for (const id of deletedIds) {
    broadcast("userRequest", "deleted", { id }, READERS);
  }
};

module.exports = { name: "userRequests", model: ResidentVerification, publish };
