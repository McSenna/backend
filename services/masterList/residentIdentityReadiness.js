"use strict";

const MasterResident = require("../../models/MasterResident");
const { serviceUnavailable } = require("../../utils/AppError");
const { IDENTITY_INDEX } = require("./residentIdentity");

// Fail closed if deployment skipped the migration or disabled automatic index
// creation. Do not accept writes with an unprotected legacy population.
const assertIdentityEnforcement = async () => {
  const indexes = await MasterResident.collection.indexes();
  const index = indexes.find((entry) => entry.name === IDENTITY_INDEX);
  if (!index?.unique || index.sparse || index.partialFilterExpression ||
      Object.keys(index.key).length !== 1 || index.key.identityKey !== 1 ||
      await MasterResident.exists({ identityKey: { $not: /^[a-f0-9]{64}$/ } })) {
    throw serviceUnavailable("Master list maintenance is required before saving records. Contact the administrator.");
  }
};

module.exports = { assertIdentityEnforcement };
