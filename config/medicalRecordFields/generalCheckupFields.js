"use strict";

const { doctorVitals } = require("./sharedFields");

const GENERAL_CHECKUP_FIELDS = Object.freeze([
  {
    key: "chiefComplaint",
    label: "Chief complaint",
    type: "text",
    group: "Presenting complaint",
    required: true,
    maxLength: 500,
    helper: "What brought the patient in today?",
  },
  {
    key: "symptoms",
    label: "Symptoms",
    type: "textarea",
    group: "Presenting complaint",
    required: false,
    maxLength: 2000,
  },

  ...doctorVitals("Vital signs"),
  {
    key: "weightKg",
    label: "Weight",
    type: "number",
    group: "Vital signs",
    unit: "kg",
    required: false,
    min: 1,
    max: 400,
  },
  {
    key: "heightCm",
    label: "Height",
    type: "number",
    group: "Vital signs",
    unit: "cm",
    required: false,
    min: 30,
    max: 250,
  },

  {
    key: "medicationAdvice",
    label: "Treatment / management",
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

module.exports = { GENERAL_CHECKUP_FIELDS };
