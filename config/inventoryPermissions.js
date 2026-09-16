"use strict";

const INVENTORY_PERMISSIONS = {
  admin: { view: true, create: true, edit: true, stockIn: true, stockOut: true, history: true, deactivate: true },
  doctor: { view: true, create: false, edit: false, stockIn: false, stockOut: true, history: true, deactivate: false },
  midwife: { view: true, create: false, edit: false, stockIn: false, stockOut: true, history: true, deactivate: false },
  bhw: { view: true, create: false, edit: false, stockIn: true, stockOut: true, history: true, deactivate: false },
  resident: { view: false, create: false, edit: false, stockIn: false, stockOut: false, history: false, deactivate: false },
};

function permissionsFor(role) {
  return INVENTORY_PERMISSIONS[String(role || "").trim().toLowerCase()] || INVENTORY_PERMISSIONS.resident;
}

function can(role, capability) {
  return Boolean(permissionsFor(role)[capability]);
}

module.exports = { INVENTORY_PERMISSIONS, permissionsFor, can };
