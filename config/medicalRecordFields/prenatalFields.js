"use strict";

const { bloodPressurePair, pulseRate } = require("./sharedFields");

const PRENATAL_FIELDS = Object.freeze([
  {
    key: "gestationalAgeWeeks",
    label: "Gestational age",
    type: "number",
    group: "Pregnancy",
    unit: "weeks",
    required: false,
    min: 1,
    max: 45,
  },
  {
    key: "gestationalAgeDays",
    label: "Additional days",
    type: "number",
    group: "Pregnancy",
    unit: "days",
    required: false,
    min: 0,
    max: 6,
  },
  {
    key: "gravida",
    label: "Gravida",
    type: "number",
    group: "Pregnancy",
    required: false,
    min: 1,
    max: 20,
    helper: "Total pregnancies, including this one.",
  },
  {
    key: "para",
    label: "Para",
    type: "number",
    group: "Pregnancy",
    required: false,
    min: 0,
    max: 20,
    helper: "Births carried to viability.",
  },

  {
    key: "weightKg",
    label: "Weight",
    type: "number",
    group: "Maternal vitals",
    unit: "kg",
    required: false,
    min: 20,
    max: 250,
  },
  ...bloodPressurePair("Maternal vitals"),
  pulseRate("Maternal vitals"),

  {
    key: "fundalHeight",
    label: "Fundal height",
    type: "number",
    group: "Prenatal examination",
    unit: "cm",
    required: false,
    min: 5,
    max: 50,
  },
  {
    key: "fetalHeartRate",
    label: "Fetal heart rate",
    type: "number",
    group: "Prenatal examination",
    unit: "bpm",
    required: false,
    min: 60,
    max: 220,
  },
  {
    key: "fetalMovement",
    label: "Fetal movement",
    type: "select",
    group: "Prenatal examination",
    required: false,
    options: [
      { value: "active", label: "Active" },
      { value: "reduced", label: "Reduced" },
      { value: "not_felt", label: "Not felt" },
      { value: "not_yet_expected", label: "Not yet expected" },
    ],
  },

  {
    key: "maternalComplaints",
    label: "Maternal complaints",
    type: "textarea",
    group: "Maternal condition",
    required: false,
    maxLength: 2000,
  },
  {
    key: "maternalCondition",
    label: "Maternal condition",
    type: "textarea",
    group: "Maternal condition",
    required: false,
    maxLength: 2000,
  },

  {
    key: "prenatalNotes",
    label: "Prenatal notes",
    type: "textarea",
    group: "Plan",
    required: false,
    maxLength: 2000,
  },
  {
    key: "nextCheckupDate",
    label: "Next prenatal visit",
    type: "date",
    group: "Plan",
    required: false,
  },
]);

module.exports = { PRENATAL_FIELDS };
