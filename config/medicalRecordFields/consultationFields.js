"use strict";

const { doctorVitals } = require("./sharedFields");

const CONSULTATION_FIELDS = Object.freeze([
  {
    key: "reasonForConsultation",
    label: "Reason for consultation",
    type: "text",
    group: "Consultation",
    required: true,
    maxLength: 500,
  },
  {
    key: "chiefComplaint",
    label: "Chief complaint",
    type: "text",
    group: "Consultation",
    required: false,
    maxLength: 500,
  },
  {
    key: "historyOfPresentIllness",
    label: "History of present illness",
    type: "textarea",
    group: "Consultation",
    required: false,
    maxLength: 4000,
  },
  {
    key: "patientConcern",
    label: "Current symptoms",
    type: "textarea",
    group: "Consultation",
    required: false,
    maxLength: 2000,
  },
  {
    key: "relevantMedicalHistory",
    label: "Relevant medical history",
    type: "textarea",
    group: "History",
    required: false,
    maxLength: 4000,
    helper: "Only what bears on today's consultation.",
  },

  ...doctorVitals("Vital signs"),

  {
    key: "treatmentAdvice",
    label: "Treatment / management plan",
    type: "textarea",
    group: "Management",
    required: false,
    maxLength: 2000,
  },
  {
    key: "followUpInstructions",
    label: "Follow-up instructions",
    type: "textarea",
    group: "Management",
    required: false,
    maxLength: 2000,
  },
]);

module.exports = { CONSULTATION_FIELDS };
