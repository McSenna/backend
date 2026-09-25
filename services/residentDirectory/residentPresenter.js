"use strict";

const User = require("../../models/User");
const { resolveUserStatus } = require("../../models/User");
const { bucketOfStatus } = require("./residentQuery");

const referenceFor = (id) => `RES-${String(id).slice(-6).toUpperCase()}`;

const serializeResident = (resident) => ({
  _id: resident._id,
  reference: referenceFor(resident._id),
  firstName: resident.firstName || "",
  middleName: resident.middleName || "",
  surname: resident.surname || "",
  suffix: resident.suffix || "",
  fullname: resident.fullname,
  email: resident.email,
  phone: resident.phone || "",
  address: resident.address || "",
  addressDetails: resident.addressDetails ?? null,
  profilePhoto: resident.profilePhoto || "",
  status: resolveUserStatus(resident),
  createdAt: resident.createdAt,
});

const summarizeResidents = async () => {
  const buckets = await User.aggregate([
    { $match: { role: "resident" } },
    {
      $group: {
        _id: {
          $ifNull: ["$status", { $cond: [{ $eq: ["$verified", true] }, "active", "pending"] }],
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = { total: 0, active: 0, inactive: 0, pending: 0, suspended: 0 };
  buckets.forEach(({ _id, count }) => {
    summary.total += count;
    const bucket = bucketOfStatus(_id);
    if (bucket) summary[bucket] += count;
  });
  return summary;
};

module.exports = { referenceFor, serializeResident, summarizeResidents };
