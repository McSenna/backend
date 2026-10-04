"use strict";

const { getCompletionForms } = require("./medicalRecord/completionFormsController");
const { startProcessing } = require("./medicalRecord/processingController");
const { completeAppointment } = require("./medicalRecord/completionController");
const { getMedicalRecord, listCompletedAppointments } = require("./medicalRecord/recordReadController");
const { getMyMedicalRecords, searchMyMedicalRecords } = require("./medicalRecord/residentRecordController");

module.exports = {
  getCompletionForms,
  startProcessing,
  completeAppointment,
  getMedicalRecord,
  getMyMedicalRecords,
  searchMyMedicalRecords,
  listCompletedAppointments,
};
