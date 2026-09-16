"use strict";

const { getCompletionForms } = require("./medicalRecord/completionFormsController");
const { startProcessing } = require("./medicalRecord/processingController");
const { completeAppointment } = require("./medicalRecord/completionController");
const {
  getMedicalRecord,
  getMyMedicalRecords,
  listCompletedAppointments,
} = require("./medicalRecord/recordReadController");

module.exports = {
  getCompletionForms,
  startProcessing,
  completeAppointment,
  getMedicalRecord,
  getMyMedicalRecords,
  listCompletedAppointments,
};
