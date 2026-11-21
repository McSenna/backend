"use strict";

/**
 * How long device details stay on audit entries and in the devices collection.
 * The audit entry itself (who did what, when) is kept; only the device snapshot
 * and the raw User-Agent are cleared. The privacy notice states the same period
 * (maslogCare/src/features/legal/content/privacyPolicy.ts). Changing it also
 * needs `collMod` on the devices TTL index, which keeps the value it was built with.
 */
const DEVICE_RETENTION_DAYS = 365;
const DEVICE_RETENTION_SECONDS = DEVICE_RETENTION_DAYS * 24 * 60 * 60;

module.exports = { DEVICE_RETENTION_DAYS, DEVICE_RETENTION_SECONDS };
