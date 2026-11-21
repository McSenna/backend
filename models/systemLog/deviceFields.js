"use strict";

const mongoose = require("mongoose");

const CONFIDENCE = ["high", "medium", "low"];
const FIELD_CONFIDENCE = ["high", "medium", "low", "none"];

// Truncates instead of validating: an over-long value must never fail the audit write it rides on.
const text = (limit) => ({ type: String, default: null, trim: true, set: (value) => (typeof value === "string" ? value.slice(0, limit) : value) });
const flag = { type: Boolean, default: null };
const fieldConfidence = { type: String, enum: FIELD_CONFIDENCE, default: "none" };

/**
 * The device an audit entry came from, frozen when the action happened. Display
 * and investigation only: nothing reads it to grant or refuse access. After the
 * retention period only `purgedAt` is left (services/device/deviceRetention.js).
 */
const DeviceSnapshotSchema = new mongoose.Schema(
  {
    installId: text(36),
    platform: { type: String, enum: ["android", "ios", "web", "unknown"], default: "unknown" },
    deviceType: { type: String, enum: ["phone", "tablet", "desktop", "tv", "unknown"], default: "unknown" },
    brand: text(40),
    /** Lowercase slug of brand, for the filter. */
    brandKey: text(40),
    manufacturer: text(40),
    /** As the device reports it ("SM-S918B", "iPhone17,1"). Never replaced by a marketing name. */
    modelRaw: text(64),
    modelName: text(64),
    deviceName: text(64),
    deviceNameIsGeneric: { type: Boolean, default: false },
    osName: text(32),
    osVersion: text(32),
    apiLevel: { type: Number, default: null },
    browserName: text(40),
    browserVersion: text(32),
    inAppBrowser: text(40),
    appVersion: text(32),
    buildNumber: text(32),
    /** False on an emulator or simulator. */
    isDevice: flag,
    isRooted: flag,
    source: { type: String, enum: ["native", "ua-client-hints", "ua-string", "server-ua", "none"] },
    confidence: { type: String, enum: CONFIDENCE },
    fieldConfidence: {
      model: fieldConfidence,
      os: fieldConfidence,
      browser: fieldConfidence,
    },
    /** Why the request contradicted the client's report, when it did. */
    mismatch: { type: [String], default: undefined },
    capturedAt: { type: Date },
    purgedAt: { type: Date },
  },
  { _id: false },
);

module.exports = { DeviceSnapshotSchema };
