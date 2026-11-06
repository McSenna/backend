"use strict";
const ManagedDevice = require("../../models/ManagedDevice");
const { unauthorized } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");

// Resident device provisioning was removed on 2026-11-06, and new sessions carry
// no deviceId. Tokens issued before then still name a device. One an
// administrator already revoked stays ended instead of working again until it
// expires (JWT_EXPIRES_IN, 7 days by default). The resident signs in again with
// their password. Once those tokens have expired this never matches, and it can
// be deleted together with the ManagedDevice model.
const assertDeviceSessionNotRevoked = async (deviceId) => {
  if (!deviceId || !isValidObjectId(deviceId)) return;
  if (await ManagedDevice.exists({ _id: deviceId, revokedAt: { $ne: null } })) {
    // INVALID_TOKEN because every installed app version signs out on it.
    throw unauthorized(
      "Your session has ended. Please sign in again.",
      ERROR_CODES.INVALID_TOKEN
    );
  }
};

module.exports = { assertDeviceSessionNotRevoked };
