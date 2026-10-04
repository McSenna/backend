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

  // No route deletes records; if a script does, only the id goes out.
  for (const id of deletedIds) {
    broadcast("medicalRecord", "deleted", { id }, [STAFF_ROOM]);
    broadcast("myMedicalRecord", "deleted", { id }, [roleRoom("resident")]);
  }
};

module.exports = { name: "medicalRecords", model: MedicalRecord, publish };
