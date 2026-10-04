"use strict";

const idOf = (value) => String(value?._id ?? value ?? "");

/**
 * Splits a batch from the change feed. Live ids are re-read through the REST
 * query; deleted ids only ever leave as `{ id }`, since the record is gone and
 * there is nothing left to authorize against.
 */
const splitChanges = (changes) => ({
  liveIds: changes.filter((change) => change.action !== "deleted").map((change) => change.id),
  deletedIds: changes.filter((change) => change.action === "deleted").map((change) => change.id),
  actionOf: (id) => changes.find((change) => change.id === idOf(id))?.action ?? "updated",
  changed: (id, keys) =>
    changes.some(
      (change) =>
        change.id === idOf(id) &&
        change.updatedKeys.some((key) => keys.some((watched) => key === watched || key.startsWith(`${watched}.`)))
    ),
});

module.exports = { idOf, splitChanges };
