"use strict";

// Whether an encoded record reaches a resident account. Nothing is stored on
// the record: it is linked while some account holds its master list ID, so a
// link or unlink on the account applies to every record at once.

const User = require("../../models/User");
const ResidentVerification = require("../../models/ResidentVerification");
const { ENCODABLE_SOURCES, isAppointmentSource } = require("../../config/medicalRecordSources");

const LINKAGE = Object.freeze({
  LINKED: "linked",
  PENDING_REVIEW: "pending_review",
  UNLINKED: "unlinked",
});

const LINKAGE_VALUES = Object.freeze(Object.values(LINKAGE));

// A sign-up waiting in User Requests whose master list check named this ID.
const PENDING_CHECK = { verificationStatus: "pending" };

const linkageFor = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const [users, pending] = await Promise.all([
    User.find({ masterResidentId: { $in: unique } }).select("_id masterResidentId").lean(),
    ResidentVerification.find({ ...PENDING_CHECK, "masterListCheck.candidateIds": { $in: unique } })
      .select("masterListCheck.candidateIds")
      .lean(),
  ]);

  const accountById = new Map(users.map((user) => [user.masterResidentId, user._id]));
  const pendingIds = new Set(pending.flatMap((entry) => entry.masterListCheck?.candidateIds ?? []));

  return new Map(
    unique.map((id) => {
      if (accountById.has(id)) return [id, { status: LINKAGE.LINKED, accountId: accountById.get(id) }];
      if (pendingIds.has(id)) return [id, { status: LINKAGE.PENDING_REVIEW, accountId: null }];
      return [id, { status: LINKAGE.UNLINKED, accountId: null }];
    })
  );
};

// Appointment records always belong to an account.
const linkageOfRecord = (record, linkageMap) =>
  isAppointmentSource(record.source)
    ? LINKAGE.LINKED
    : linkageMap.get(record.masterResidentId)?.status ?? LINKAGE.UNLINKED;

const linkedAndPendingIds = async () => {
  const [linked, pending] = await Promise.all([
    User.distinct("masterResidentId", { masterResidentId: { $type: "string" } }),
    ResidentVerification.distinct("masterListCheck.candidateIds", PENDING_CHECK),
  ]);
  const linkedSet = new Set(linked);
  return { linked, pendingOnly: pending.filter((id) => !linkedSet.has(id)) };
};

const APPOINTMENT_FILTER = { source: { $in: ["appointment", null] } };
const ENCODED_FILTER = { source: { $in: ENCODABLE_SOURCES } };

// Mongo filter for one linkage status; the counts and the list share it, so a
// summary card always matches the list it opens.
const linkageFilter = async (status) => {
  if (!LINKAGE_VALUES.includes(status)) return null;
  const { linked, pendingOnly } = await linkedAndPendingIds();
  if (status === LINKAGE.LINKED) {
    return { $or: [APPOINTMENT_FILTER, { ...ENCODED_FILTER, masterResidentId: { $in: linked } }] };
  }
  if (status === LINKAGE.PENDING_REVIEW) return { ...ENCODED_FILTER, masterResidentId: { $in: pendingOnly } };
  return { ...ENCODED_FILTER, masterResidentId: { $nin: [...linked, ...pendingOnly] } };
};

module.exports = {
  LINKAGE,
  LINKAGE_VALUES,
  APPOINTMENT_FILTER,
  ENCODED_FILTER,
  linkageFor,
  linkageOfRecord,
  linkageFilter,
};
