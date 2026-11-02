"use strict";

const MedicalRecord = require("../../models/MedicalRecord");
const {
  masterlistRowQuery,
  presentMasterlistRows,
} = require("../../services/medicalRecord/masterlistReadService");
const {
  residentRecordQuery,
  residentOwnersOf,
} = require("../../services/medicalRecord/residentRecordQuery");
const { forResident } = require("../../services/medicalRecord/residentRecordView");
const { broadcast } = require("../broadcast");
const { STAFF_ROOM, roleRoom, serviceOwnerRooms, userRoom } = require("../rooms");
const { splitChanges } = require("./shared");

// Staff read the masterlist only for the services their role runs (admins: all),
// exactly as masterlistQuery.serviceScope narrows the REST list.
const publishStaffRows = async (ids, actionOf) => {
  const records = await masterlistRowQuery({ _id: { $in: ids } }).lean();
  const rows = await presentMasterlistRows(records);
  rows.forEach((row, index) => {
    broadcast("medicalRecord", actionOf(row._id), row, serviceOwnerRooms(records[index].serviceType));
  });
};

// A resident reads the records of their own visits and those encoded under the
// master list identity their account holds; "notes" and audit fields are stripped.
const publishResidentRows = async (ids, actionOf) => {
  const records = await residentRecordQuery({ _id: { $in: ids } }).lean();
  for (const record of records) {
    const owners = await residentOwnersOf(record);
    if (owners.length === 0) continue;
    broadcast("myMedicalRecord", actionOf(record._id), forResident(record), owners.map(userRoom));
  }
};

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    await Promise.all([publishStaffRows(liveIds, actionOf), publishResidentRows(liveIds, actionOf)]);
  }

  // A soft deletion arrives as an update. Re-read its protected tombstone to
  // authorize recipients, and emit only the identifier, never clinical values.
  const tombstones = await MedicalRecord.find({ _id: { $in: liveIds }, deletedAt: { $ne: null } }).withDeleted().lean();
  for (const record of tombstones) {
    const id = String(record._id);
    broadcast("medicalRecord", "deleted", { id }, serviceOwnerRooms(record.serviceType));
    const owners = await residentOwnersOf(record);
    broadcast("myMedicalRecord", "deleted", { id }, owners.map(userRoom));
  }
  // Hard purges have no remaining ownership evidence; clients re-fetch their
  // scoped views without disclosing the purged identifier across audiences.
  if (deletedIds.length) {
    broadcast("medicalRecord", "resync", {}, [STAFF_ROOM]);
    broadcast("myMedicalRecord", "resync", {}, [roleRoom("resident")]);
  }
};

module.exports = { name: "medicalRecords", model: MedicalRecord, publish };
