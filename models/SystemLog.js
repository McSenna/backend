"use strict";

const mongoose = require("mongoose");
const { logFields } = require("./systemLog/logFields");
const { VALID_ACTIONS, VALID_ROLES, VALID_SEVERITIES } = require("./systemLog/logVocabulary");

const SystemLogSchema = new mongoose.Schema(logFields, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: "systemlogs",
});

const QUERY_INDEXES = [
  { createdAt: -1 },
  { action: 1, createdAt: -1 },
  { role: 1, createdAt: -1 },
  { platform: 1, createdAt: -1 },
  { ipAddress: 1, createdAt: -1 },
  { action: 1, role: 1, createdAt: -1 },
  { severity: 1, createdAt: -1 },
];

for (const index of QUERY_INDEXES) SystemLogSchema.index(index);

module.exports = mongoose.model("SystemLog", SystemLogSchema, "systemlogs");
module.exports.VALID_ACTIONS = VALID_ACTIONS;
module.exports.VALID_ROLES = VALID_ROLES;
module.exports.VALID_SEVERITIES = VALID_SEVERITIES;
