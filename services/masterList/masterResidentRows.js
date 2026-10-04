"use strict";

// The admin list's row shape, shared with realtime/publishers/masterResidents.js
// so pushed rows match listed rows.

const MasterResident = require("../../models/MasterResident");
const User = require("../../models/User");
const { toAdminView } = require("./masterListReview");

const linkedIdsAmong = async (records) => {
  const ids = records.map((record) => record.masterResidentId);
  if (ids.length === 0) return new Set();
  const users = await User.find({ masterResidentId: { $in: ids } }).select("masterResidentId").lean();
  return new Set(users.map((user) => user.masterResidentId));
};

const toRow = (record, linked) => ({
  _id: String(record._id),
  ...toAdminView(record),
  linkedAccount: linked.has(record.masterResidentId),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const presentMasterResidents = async (records) => {
  const linked = await linkedIdsAmong(records);
  return records.map((record) => toRow(record, linked));
};

const findMasterResidentRows = async (ids) =>
  presentMasterResidents(await MasterResident.find({ _id: { $in: ids } }).lean());

// Read-only handle for the realtime change feed, which only watches the collection.
const masterResidentFeed = MasterResident;

module.exports = { linkedIdsAmong, toRow, presentMasterResidents, findMasterResidentRows, masterResidentFeed };
