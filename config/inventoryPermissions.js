"use strict";

// Admins oversee inventory but never change it. BHWs run it: they add, correct and
// deactivate items and receive and release stock. Clinicians release what they dispense.
// "ledger" is the facility-wide movement history and its export; "correct" records returns,
// count corrections and reversals. An item's own history stays with "history".
const INVENTORY_PERMISSIONS = {
  admin: { view: true, create: false, edit: false, stockIn: false, stockOut: false, history: true, deactivate: false, ledger: true, correct: false },
  doctor: { view: true, create: false, edit: false, stockIn: false, stockOut: true, history: true, deactivate: false, ledger: false, correct: false },
  midwife: { view: true, create: false, edit: false, stockIn: false, stockOut: true, history: true, deactivate: false, ledger: false, correct: false },
  bhw: { view: true, create: true, edit: true, stockIn: true, stockOut: true, history: true, deactivate: true, ledger: false, correct: true },
  resident: { view: false, create: false, edit: false, stockIn: false, stockOut: false, history: false, deactivate: false, ledger: false, correct: false },
};

const WRITE_CAPABILITIES = ["create", "edit", "stockIn", "stockOut", "deactivate", "correct"];

// Unknown or missing roles fall through to the resident row, which allows nothing.
function permissionsFor(role) {
  return INVENTORY_PERMISSIONS[String(role || "").trim().toLowerCase()] || INVENTORY_PERMISSIONS.resident;
}

function can(role, capability) {
  return Boolean(permissionsFor(role)[capability]);
}

function isViewOnly(role) {
  const permissions = permissionsFor(role);
  return permissions.view && !WRITE_CAPABILITIES.some((capability) => permissions[capability]);
}

module.exports = { INVENTORY_PERMISSIONS, WRITE_CAPABILITIES, permissionsFor, can, isViewOnly };
