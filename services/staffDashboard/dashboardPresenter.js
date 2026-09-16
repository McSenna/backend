"use strict";

const { getCategory, CONSULTATION_CATEGORIES } = require("../../config/consultationCategories");
const { getServiceFields } = require("../../config/medicalRecordFields");

const DASHBOARD_SAFE_DETAILS = {
  bp_checking: ["systolic", "diastolic", "pulseRate"],
};

const highlightsFor = (serviceType, serviceDetails) => {
  const allowed = DASHBOARD_SAFE_DETAILS[serviceType];
  if (!allowed || !serviceDetails) return [];

  const fields = getServiceFields(serviceType);
  const out = [];

  for (const key of allowed) {
    const value = serviceDetails[key];
    if (value === null || value === undefined || value === "") continue;
    const field = fields.find((candidate) => candidate.key === key);
    out.push({
      key,
      label: field?.label ?? key,
      value: String(value),
      unit: field?.unit ?? "",
    });
  }

  return out;
};

const toDashboardAppointment = (appointment) => ({
  _id: String(appointment._id),
  consultationType: appointment.consultationType,
  serviceLabel: getCategory(appointment.consultationType)?.label ?? appointment.consultationType,
  status: appointment.status,
  slotStart: appointment.slotStart,
  slotEnd: appointment.slotEnd,
  isUrgent: Boolean(appointment.isUrgent),
  patientName: appointment.resident?.fullname ?? "Unnamed patient",
  medicalRecord: appointment.medicalRecord ? String(appointment.medicalRecord) : null,
});

const toRecentActivity = (record) => ({
  _id: String(record._id),
  medicalRecord: String(record._id),
  appointment: record.appointment ? String(record.appointment) : null,
  patientName: record.resident?.fullname ?? "Unnamed patient",
  providerName: record.provider?.fullname ?? "",
  serviceType: record.serviceType,
  serviceLabel: getCategory(record.serviceType)?.label ?? record.serviceType,
  completedAt: record.completedAt,
  itemsGivenCount: (record.itemsGiven ?? []).length,
  highlights: highlightsFor(record.serviceType, record.serviceDetails),
});

const toInventoryAlert = (item) => ({
  _id: String(item._id),
  name: item.name,
  specification: item.specification ?? "",
  category: item.category,
  unit: item.unit,
  currentStock: item.currentStock,
  reorderLevel: item.reorderLevel,
  nearestExpiry: item.nearestExpiry,
});

const visibleServices = (categoryKeys) =>
  CONSULTATION_CATEGORIES.filter(
    (category) => categoryKeys === null || categoryKeys.includes(category.key)
  ).map((category) => ({ key: category.key, label: category.label }));

module.exports = {
  highlightsFor,
  toDashboardAppointment,
  toRecentActivity,
  toInventoryAlert,
  visibleServices,
};
