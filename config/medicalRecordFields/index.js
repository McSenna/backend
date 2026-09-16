"use strict";

const { CONSULTATION_CATEGORIES, getCategory } = require("../consultationCategories");
const { FIELD_TYPES, COMMON_FIELDS, FOLLOW_UP_FIELDS } = require("./sharedFields");
const { GENERAL_CHECKUP_FIELDS } = require("./generalCheckupFields");
const { CONSULTATION_FIELDS } = require("./consultationFields");
const { PRENATAL_FIELDS } = require("./prenatalFields");
const { IMMUNIZATION_FIELDS } = require("./immunizationFields");
const { BP_CHECKING_FIELDS } = require("./bpCheckingFields");

const SERVICE_FIELDS = Object.freeze({
  general_checkup: GENERAL_CHECKUP_FIELDS,
  consultation: CONSULTATION_FIELDS,
  prenatal: PRENATAL_FIELDS,
  immunization: IMMUNIZATION_FIELDS,
  bp_checking: BP_CHECKING_FIELDS,
});

const getServiceFields = (categoryKey) =>
  SERVICE_FIELDS[categoryKey] ? [...SERVICE_FIELDS[categoryKey]] : [];

const getCompletionForm = (categoryKey) => {
  const category = getCategory(categoryKey);
  return {
    categoryKey,
    label: category?.label ?? categoryKey,
    common: [...COMMON_FIELDS],
    service: getServiceFields(categoryKey),
    followUp: [...FOLLOW_UP_FIELDS],
  };
};

const getAllCompletionForms = () =>
  CONSULTATION_CATEGORIES.map((category) => getCompletionForm(category.key));

module.exports = {
  FIELD_TYPES,
  COMMON_FIELDS,
  FOLLOW_UP_FIELDS,
  SERVICE_FIELDS,
  getServiceFields,
  getCompletionForm,
  getAllCompletionForms,
};
