"use strict";

const mongoose = require("mongoose");
const { DEVICE_RETENTION_SECONDS } = require("../config/deviceRetention");

/**
 * What an app install or browser profile reported about itself, keyed by its
 * install id and the hash of the exact report. A changed report (an OS update)
 * is a new row, so a stored row never changes content. Lets later requests send
 * only X-Device-Id and X-Device-Hash. Audit entries keep their own copy, so a
 * row expiring here never changes a log. No user link on purpose: logs hold that.
 */
const schema = new mongoose.Schema(
  {
    installId: { type: String, required: true },
    hash: { type: String, required: true },
    info: { type: mongoose.Schema.Types.Mixed, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { collection: "devices", versionKey: false },
);

schema.index({ installId: 1, hash: 1 }, { unique: true });
schema.index({ lastSeenAt: 1 }, { expireAfterSeconds: DEVICE_RETENTION_SECONDS });

module.exports = mongoose.model("Device", schema);
