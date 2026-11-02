"use strict";
const User = require("../../models/User");
const Baby = require("../../models/Baby");
const { verifiedAccountFilter } = require("./access");
const { forbidden } = require("../../utils/AppError");
const protectedAppointmentRows = async (rows) => {
  const linked = rows.filter((row) => row.immunizationBabyId);
  if (!linked.length) return rows;
  const users = await User.find({
    _id: { $in: linked.map((row) => row.resident) },
    ...verifiedAccountFilter({ $type: "string" }),
  })
    .select("_id masterResidentId")
    .lean();
  const babies = await Baby.find({
    _id: { $in: linked.map((row) => row.immunizationBabyId) },
  })
    .select("_id motherMasterResidentId")
    .lean();
  const userLinks = new Map(
    users.map((user) => [String(user._id), user.masterResidentId]),
  );
  const motherLinks = new Map(
    babies.map((baby) => [String(baby._id), baby.motherMasterResidentId]),
  );
  const allowed = rows.filter(
    (row) =>
      !row.immunizationBabyId ||
      (userLinks.has(String(row.resident)) &&
        userLinks.get(String(row.resident)) ===
          motherLinks.get(String(row.immunizationBabyId))),
  );
  return allowed.map((row) => {
    if (!row.immunizationBabyId) return row;
    const { immunizationAccountHistory, ...safe } = row.toObject
      ? row.toObject()
      : row;
    return safe;
  });
};
const assertAppointmentLink = async (appointment) => {
  if (!(await protectedAppointmentRows([appointment])).length)
    throw forbidden(
      "This appointment is not linked to your verified patient identity.",
    );
};
module.exports = { protectedAppointmentRows, assertAppointmentLink };
