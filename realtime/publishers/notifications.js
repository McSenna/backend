"use strict";

const Notification = require("../../models/Notification");
const { mapToNotificationItem } = require("../../services/notification/notificationPresenter");
const { broadcast, resync } = require("../broadcast");
const { STAFF_ROLES, roleRoom, userRoom } = require("../rooms");
const { idOf, splitChanges } = require("./shared");

// Deleting an announcement removes one alert per recipient. Recipients are
// unknown once the rows are gone, so a large removal becomes one "reload your
// inbox" signal rather than hundreds of id events to every device.
const BULK_THRESHOLD = 20;

const EVERYONE = ["resident", ...STAFF_ROLES].map(roleRoom);

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    const rows = await Notification.find({ _id: { $in: liveIds } }).lean();
    for (const row of rows) {
      broadcast("notification", actionOf(row._id), mapToNotificationItem(row), [userRoom(idOf(row.recipient))]);
    }
  }

  if (deletedIds.length > BULK_THRESHOLD) {
    resync("notification", EVERYONE);
    return;
  }
  for (const id of deletedIds) {
    broadcast("notification", "deleted", { id }, EVERYONE);
  }
};

module.exports = { name: "notifications", model: Notification, publish };
