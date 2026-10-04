"use strict";

// One entry per watched collection. Adding a realtime resource means writing a
// publisher (re-read through the REST query, pick the rooms that mirror the
// REST guard) and listing it here.
module.exports = [
  require("./appointments"),
  require("./medicalRecords"),
  require("./missionSchedules"),
  require("./inventory"),
  require("./announcements"),
  require("./supportTickets"),
  require("./users"),
  require("./userRequests"),
  require("./masterResidents"),
  require("./notifications"),
  require("./systemLogs"),
];
