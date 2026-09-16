"use strict";

const ROLE_ORDER = ["admin", "doctor", "midwife", "bhw", "resident"];

const ROLE_LABELS = {
  admin: "Admin",
  doctor: "Doctor",
  midwife: "Midwife",
  bhw: "BHW",
  resident: "Resident",
};

const buildRoleDistribution = (roleCounts) => {
  const countsByRole = new Map(
    roleCounts.map((entry) => [String(entry._id || "unknown"), entry.count])
  );

  return ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    count: countsByRole.get(role) || 0,
  }));
};

const toRecentActivity = (log) => ({
  _id: String(log._id),
  action: log.action,
  actorName: log.userId?.fullname || "",
  role: log.userId?.role || log.role || "unknown",
  description: log.description || "",
  resource: log.resource || "",
  platform: log.platform || "",
  success: log.success !== false,
  createdAt: log.createdAt,
});

const toRecentUser = (user) => ({
  _id: String(user._id),
  fullname: user.fullname,
  email: user.email,
  profilePhoto: user.profilePhoto || "",
  role: user.role,
  verified: Boolean(user.verified),
  createdAt: user.createdAt,
});

const monthlyKey = (bucket) => ({ key: `${bucket._id.y}-${bucket._id.m}`, count: bucket.count });

const dailyKey = (bucket) => ({
  key: `${bucket._id.y}-${bucket._id.m}-${bucket._id.d}`,
  count: bucket.count,
});

module.exports = {
  ROLE_ORDER,
  ROLE_LABELS,
  buildRoleDistribution,
  toRecentActivity,
  toRecentUser,
  monthlyKey,
  dailyKey,
};
