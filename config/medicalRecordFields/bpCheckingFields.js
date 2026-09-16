"use strict";

const { bloodPressurePair, pulseRate } = require("./sharedFields");

const BP_CHECKING_FIELDS = Object.freeze([
  { ...bloodPressurePair("Blood pressure")[0], required: true },
  { ...bloodPressurePair("Blood pressure")[1], required: true },
  pulseRate("Blood pressure"),

  {
    key: "symptoms",
    label: "Symptoms / complaints",
    type: "textarea",
    group: "Patient condition",
    required: false,
    maxLength: 2000,
    helper: "e.g. headache, dizziness, chest discomfort — or none reported.",
  },
  {
    key: "readingClassification",
    label: "Reading classification",
    type: "select",
    group: "Patient condition",
    required: false,
    options: [
      { value: "normal", label: "Normal" },
      { value: "elevated", label: "Elevated" },
      { value: "hypertension_stage_1", label: "Hypertension stage 1" },
      { value: "hypertension_stage_2", label: "Hypertension stage 2" },
      { value: "hypertensive_crisis", label: "Hypertensive crisis" },
      { value: "hypotension", label: "Hypotension" },
    ],
  },

  {
    key: "recheckDate",
    label: "Recheck date",
    type: "date",
    group: "Plan",
    required: false,
  },
  {
    key: "remarks",
    label: "Remarks",
    type: "textarea",
    group: "Plan",
    required: false,
    maxLength: 2000,
  },
]);

module.exports = { BP_CHECKING_FIELDS };
