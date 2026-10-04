"use strict";

const User = require("../../models/User");
const { serializeUser } = require("../../services/userDirectory/userPresenter");
const { serializeResident } = require("../../services/residentDirectory/residentPresenter");
const { buildUserResponse } = require("../../services/auth/authResponse");
const { broadcast, resync } = require("../broadcast");
const { STAFF_ROOM, adminRoom, roleRoom, userRoom } = require("../rooms");
const { disconnectUser } = require("../socketServer");
const { splitChanges } = require("./shared");

// GET /residents is open to BHWs and admins.
const DIRECTORY_READERS = [roleRoom("bhw"), adminRoom()];

// A change to any of these can revoke access or change which rooms the account
// belongs to, so its sockets are dropped and must pass the handshake again.
const ACCESS_KEYS = ["status", "role", "verified"];

const publishAccount = (user, action, changed) => {
  const id = String(user._id);
  broadcast("user", action, serializeUser(user), [adminRoom()]);
  broadcast("profile", action, buildUserResponse(user), [userRoom(id)]);

  if (user.role === "resident") {
    broadcast("resident", action, serializeResident(user), DIRECTORY_READERS);
  } else if (changed(id, ["role"])) {
    broadcast("resident", "deleted", { id }, DIRECTORY_READERS);
  }

  // Linking or unlinking a master list identity changes which records the
  // resident may read and the link status staff see on every one of them.
  if (changed(id, ["masterResidentId"])) {
    resync("myMedicalRecord", [userRoom(id)]);
    resync("medicalRecord", [STAFF_ROOM]);
    resync("masterResident", [adminRoom()]);
  }

  if (changed(id, ACCESS_KEYS)) disconnectUser(id);
};

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf, changed } = splitChanges(changes);

  if (liveIds.length > 0) {
    const users = await User.find({ _id: { $in: liveIds } }).select("-password").lean();
    for (const user of users) publishAccount(user, actionOf(user._id), changed);
  }

  for (const id of deletedIds) {
    broadcast("user", "deleted", { id }, [adminRoom()]);
    broadcast("resident", "deleted", { id }, DIRECTORY_READERS);
    disconnectUser(id);
  }
};

module.exports = { name: "users", model: User, publish };
