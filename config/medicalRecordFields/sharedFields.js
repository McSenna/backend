"use strict";

const FIELD_TYPES = Object.freeze(["text", "textarea", "number", "date", "select", "boolean"]);

const COMMON_FIELDS = Object.freeze([
  {
    key: "assessment",
    label: "Assessment",
    type: "textarea",
    required: true,
    maxLength: 4000,
    helper: "What you found and concluded during the visit.",
  },
  {
    key: "findings",
    label: "Findings",
    type: "textarea",
    required: false,
    maxLength: 4000,
    helper: "Observations and measurements worth keeping on file.",
  },
  {
    key: "diagnosis",
    label: "Diagnosis",
    type: "text",
    required: false,
    maxLength: 500,
  },
  {
    key: "recommendations",
    label: "Recommendations",
    type: "textarea",
    required: false,
    maxLength: 4000,
    helper: "What the patient should do next.",
  },
  {
    key: "notes",
    label: "Notes",
    type: "textarea",
    required: false,
    maxLength: 4000,
    helper: "Anything else worth recording. Not shown to the resident.",
  },
]);

const FOLLOW_UP_FIELDS = Object.freeze([
  { key: "followUpRequired", label: "Follow-up required", type: "boolean", required: false },
  {
    key: "followUpDate",
    label: "Follow-up date",
    type: "date",
    required: false,
    dependsOn: "followUpRequired",
  },
]);

const bloodPressurePair = (group) => [
  {
    key: "systolic",
    label: "Systolic",
    type: "number",
    group,
    unit: "mmHg",
    required: false,
    min: 50,
    max: 300,
  },
  {
    key: "diastolic",
    label: "Diastolic",
    type: "number",
    group,
    unit: "mmHg",
    required: false,
    min: 30,
    max: 200,
  },
];

const pulseRate = (group) => ({
  key: "pulseRate",
  label: "Pulse rate",
  type: "number",
  group,
  unit: "bpm",
  required: false,
  min: 30,
  max: 220,
});

const doctorVitals = (group) => [
  {
    key: "temperature",
    label: "Temperature",
    type: "number",
    group,
    unit: "°C",
    required: false,
    min: 30,
    max: 45,
  },
  ...bloodPressurePair(group),
  pulseRate(group),
  {
    key: "respiratoryRate",
    label: "Respiratory rate",
    type: "number",
    group,
    unit: "breaths/min",
    required: false,
    min: 5,
    max: 80,
  },
];

module.exports = {
  FIELD_TYPES,
  COMMON_FIELDS,
  FOLLOW_UP_FIELDS,
  bloodPressurePair,
  pulseRate,
  doctorVitals,
};
