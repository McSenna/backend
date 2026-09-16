"use strict";

const SUPPORTED_ID_TYPES = [
  { id: "philsys", label: "PhilSys National ID", maskPattern: "XXXX-XXXX-XXXX-XXXX" },
  { id: "drivers_license", label: "Driver's License", maskPattern: "XXX-XX-XXXXXX" },
  { id: "tin_id", label: "TIN ID", maskPattern: "XXX-XXX-XXX-000" },
  { id: "passport", label: "Passport", maskPattern: "PXXXXXXX" },
  { id: "umid", label: "UMID", maskPattern: "XXXX-XXXXXXX-X" },
  { id: "postal_id", label: "Postal ID", maskPattern: "PRN XXXXXXXXXXXX" },
  { id: "voters_id", label: "Voter-related identification document", maskPattern: "XXXXXXXXXXXX" },
  { id: "senior_citizen_id", label: "Senior Citizen ID", maskPattern: "OSCA-XXXXX" },
  { id: "pwd_id", label: "PWD ID", maskPattern: "PWD-XXXXX" },
  { id: "school_id", label: "School ID", maskPattern: "ID-XXXXXX" },
  { id: "employee_id", label: "Employee ID", maskPattern: "EMP-XXXXXX" },
  { id: "other_gov_id", label: "Other Government-Issued ID", maskPattern: "XXXX-XXXX-XXXX" },
];

const REJECTION_REASONS = [
  "Information does not match the ID",
  "Invalid ID",
  "ID image is unreadable",
  "Incomplete registration information",
  "Duplicate account",
  "Resident verification failed",
  "Other",
];

const ID_DOCUMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  allowedMimes: ["image/jpeg", "image/png", "image/jpg", "application/pdf"],
  allowedExtensions: [".jpg", ".jpeg", ".png", ".pdf"],
};

function maskIdNumber(idNumber) {
  if (!idNumber || typeof idNumber !== "string") return "****";
  const clean = idNumber.trim();
  if (clean.length <= 4) return clean;
  const lastFour = clean.slice(-4);
  return `**** **** **** ${lastFour}`;
}

module.exports = {
  SUPPORTED_ID_TYPES,
  REJECTION_REASONS,
  ID_DOCUMENT_LIMITS,
  maskIdNumber,
};
