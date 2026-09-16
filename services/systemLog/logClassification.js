"use strict";

const VALID_ACTIONS = new Set(require("../../models/SystemLog").VALID_ACTIONS || []);

const normalizeAction = (action) => {
  const value = typeof action === "string" ? action.trim().toUpperCase() : "";
  return VALID_ACTIONS.has(value) ? value : null;
};

const MODULE_RULES = [
  { test: /^LOGIN|^LOGOUT/, module: "Authentication", logType: "User Authentication" },
  {
    test: /^RESIDENT_WEB_LOGIN_BLOCKED$|^PLATFORM_ACCESS_DENIED$/,
    module: "Authentication",
    logType: "User Authentication",
  },
  { test: /^USER_/, module: "User Management", logType: "User Management" },
  { test: /^APPOINTMENT_/, module: "Appointments", logType: "Appointment Activity" },
  { test: /^RECORD_/, module: "Patients", logType: "Patient Records" },
  { test: /^SCHEDULE_/, module: "Scheduling", logType: "Schedule Management" },
  { test: /^INVENTORY_/, module: "Inventory", logType: "Inventory Management" },
];

const ruleFor = (action) => MODULE_RULES.find((rule) => rule.test.test(String(action || "")));

const getModuleForAction = (action) => ruleFor(action)?.module ?? "System";

const getLogTypeForAction = (action) => ruleFor(action)?.logType ?? "System Event";

const WARNING_ACTIONS = new Set([
  "RESIDENT_WEB_LOGIN_BLOCKED",
  "PLATFORM_ACCESS_DENIED",
  "USER_DELETED",
  "USER_ROLE_CHANGED",
  "USER_STATUS_CHANGED",
  "USER_UNVERIFIED",
  "USER_REJECTED",
  "APPOINTMENT_REJECTED",
  "APPOINTMENT_CANCELLED",
  "SCHEDULE_DELETED",
  "INVENTORY_ITEM_DEACTIVATED",
  "INVENTORY_ADJUSTED",
  "INVENTORY_EXPIRED_RECORDED",
]);

const SUCCESS_ACTIONS = new Set([
  "USER_CREATED",
  "USER_VERIFIED",
  "USER_APPROVED",
  "RESIDENT_REGISTRATION_SUBMITTED",
  "APPOINTMENT_APPROVED",
  "APPOINTMENT_CREATED",
  "APPOINTMENT_COMPLETED",
  "RECORD_CREATED",
  "SCHEDULE_CREATED",
  "INVENTORY_ITEM_CREATED",
  "INVENTORY_STOCK_IN",
  "INVENTORY_STOCK_OUT",
  "PASSWORD_CHANGED",
]);

const deriveSeverity = (action, success) => {
  if (success === false) return "error";
  const normalized = String(action || "").toUpperCase();
  if (/FAILED/.test(normalized)) return "error";
  if (WARNING_ACTIONS.has(normalized)) return "warning";
  if (SUCCESS_ACTIONS.has(normalized)) return "success";
  return "info";
};

module.exports = {
  normalizeAction,
  MODULE_RULES,
  getModuleForAction,
  getLogTypeForAction,
  deriveSeverity,
};
