"use strict";

// Where a medical record came from. Appointment records are written by the
// completion flow and belong to an account. Every other source is encoded by
// staff (from paper records, walk-ins or missions) and belongs to a Barangay
// Master List identity, so it exists whether or not the resident has an account.
const MEDICAL_RECORD_SOURCES = Object.freeze({
  APPOINTMENT: "appointment",
  HISTORICAL_MASTERLIST: "historical_masterlist",
  WALK_IN: "walk_in",
  MEDICAL_MISSION: "medical_mission",
  MANUAL_ENTRY: "manual_entry",
});

const ALL_SOURCES = Object.freeze(Object.values(MEDICAL_RECORD_SOURCES));

const ENCODABLE_SOURCES = Object.freeze(
  ALL_SOURCES.filter((source) => source !== MEDICAL_RECORD_SOURCES.APPOINTMENT)
);

// Records written before sources existed have no `source` field; they all came
// from completed appointments.
const isAppointmentSource = (source) =>
  !source || source === MEDICAL_RECORD_SOURCES.APPOINTMENT;

module.exports = {
  MEDICAL_RECORD_SOURCES,
  ALL_SOURCES,
  ENCODABLE_SOURCES,
  isAppointmentSource,
};
