"use strict";

const daysFromNow = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date;
};

const daysAgo = (days) => daysFromNow(-days);

const SUPPLIERS = [
  { name: "DOH Regional Office V", type: "doh", contactPerson: "Regional Pharmacist" },
  { name: "City Health Office", type: "city-health", contactPerson: "Supply Officer" },
  { name: "Barangay LGU", type: "lgu", contactPerson: "Barangay Secretary" },
];

const ITEMS = [
  {
    name: "Paracetamol 500mg",
    specification: "Tablet",
    genericName: "Paracetamol",
    category: "medicine",
    unit: "tabs",
    reorderLevel: 50,
    storageCondition: "room-temperature",
    supplier: "City Health Office",
    batch: { batchNumber: "PAR2024091", quantity: 250, expiryInDays: 460, receivedDaysAgo: 30 },
  },
  {
    name: "Amoxicillin 250mg",
    specification: "Capsule",
    genericName: "Amoxicillin",
    category: "medicine",
    unit: "caps",
    reorderLevel: 50,
    storageCondition: "room-temperature",
    supplier: "City Health Office",
    batch: { batchNumber: "AMX2024087", quantity: 30, expiryInDays: 180, receivedDaysAgo: 45 },
  },
  {
    name: "Tetanus Vaccine",
    specification: "0.5 mL (Adult)",
    genericName: "Tetanus Toxoid",
    category: "vaccine",
    unit: "vials",
    reorderLevel: 20,
    storageCondition: "refrigerated",
    supplier: "DOH Regional Office V",
    batch: { batchNumber: "TT2024082", quantity: 12, expiryInDays: 43, receivedDaysAgo: 24 },
  },
  {
    name: "Syringe 3mL",
    specification: "Disposable",
    category: "supply",
    unit: "pcs",
    reorderLevel: 100,
    storageCondition: "dry-storage",
    supplier: "City Health Office",
    batch: { batchNumber: "SYR2024095", quantity: 500, expiryInDays: 840, receivedDaysAgo: 20 },
  },
  {
    name: "BP Monitor",
    specification: "Digital",
    category: "equipment",
    unit: "units",
    reorderLevel: 2,
    storageCondition: "room-temperature",
    supplier: "Barangay LGU",
    batch: { batchNumber: "BPM2024071", quantity: 5, expiryInDays: null, receivedDaysAgo: 200 },
  },
  {
    name: "Prenatal Vitamins",
    specification: "Tablet",
    genericName: "Ferrous Sulfate + Folic Acid",
    category: "medicine",
    unit: "bottles",
    reorderLevel: 30,
    storageCondition: "room-temperature",
    supplier: "DOH Regional Office V",
    batch: { batchNumber: "PNV2024089", quantity: 18, expiryInDays: 130, receivedDaysAgo: 60 },
  },
  {
    name: "Alcohol 70%",
    specification: "500 mL",
    category: "supply",
    unit: "bottles",
    reorderLevel: 10,
    storageCondition: "dry-storage",
    supplier: "City Health Office",
    batch: { batchNumber: "ALC2024090", quantity: 24, expiryInDays: 660, receivedDaysAgo: 90, releaseAll: true },
  },
  {
    name: "Gloves (Nitrile)",
    specification: "Box (100 pcs)",
    category: "supply",
    unit: "boxes",
    reorderLevel: 50,
    storageCondition: "dry-storage",
    supplier: "City Health Office",
    batch: { batchNumber: "GLV2024088", quantity: 200, expiryInDays: 450, receivedDaysAgo: 15 },
  },
];

module.exports = { SUPPLIERS, ITEMS, daysFromNow, daysAgo };
