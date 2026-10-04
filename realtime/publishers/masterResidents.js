"use strict";

// The master list boundary (tests/unit/masterListBoundaries.test.js) keeps the
// model inside master list modules, so reads go through the row module.
const {
  findMasterResidentRows,
  masterResidentFeed,
} = require("../../services/masterList/masterResidentRows");
const { broadcast, resync } = require("../broadcast");
const { adminRoom } = require("../rooms");
const { splitChanges } = require("./shared");

// An import lands hundreds of rows at once; past this size one "reload the
// list" signal is cheaper for everyone than a row event per record.
const BULK_THRESHOLD = 50;

const READERS = [adminRoom()];

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > BULK_THRESHOLD) {
    resync("masterResident", READERS);
    return;
  }

  if (liveIds.length > 0) {
    for (const row of await findMasterResidentRows(liveIds)) {
      broadcast("masterResident", actionOf(row._id), row, READERS);
    }
  }

  for (const id of deletedIds) {
    broadcast("masterResident", "deleted", { id }, READERS);
  }
};

module.exports = { name: "masterResidents", model: masterResidentFeed, publish };
