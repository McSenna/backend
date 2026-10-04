"use strict";

const SystemLog = require("../../models/SystemLog");
const { serializeLog } = require("../../services/systemLog/logPresenter");
const { broadcast } = require("../broadcast");
const { adminRoom } = require("../rooms");
const { splitChanges } = require("./shared");

const READERS = [adminRoom()];

// Logs are append-only, so only inserts matter. Same populate as GET /system-logs.
const publish = async (changes) => {
  const { liveIds } = splitChanges(changes.filter((change) => change.action === "created"));
  if (liveIds.length === 0) return;

  const logs = await SystemLog.find({ _id: { $in: liveIds } }).populate("userId", "fullname email").lean();
  for (const log of logs) {
    broadcast("systemLog", "created", serializeLog(log), READERS);
  }
};

module.exports = { name: "systemLogs", model: SystemLog, publish };
