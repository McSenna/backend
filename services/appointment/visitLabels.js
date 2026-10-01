"use strict";

const { isWeeklyService } = require("../../config/consultationCategories");

// Immunization is run by the health center team, not on a doctor's mission.
const WEEKLY_TEAM = "Barangay health team";
const WEEKLY_PLACE = "Barangay Maslog health center";

/**
 * Who and where to name in a confirmation. A weekly visit names the child as
 * the patient (the account holder is the parent); mission visits keep the
 * mailer's existing mission wording.
 */
const visitLabels = (appointment, staffName = null) => {
  if (!isWeeklyService(appointment?.consultationType)) {
    return { weekly: false, worker: staffName || null, location: null, patientName: null };
  }
  return {
    weekly: true,
    worker: staffName || WEEKLY_TEAM,
    location: WEEKLY_PLACE,
    patientName: appointment.childName || null,
  };
};

/** The person being seen: the child for an immunization, otherwise the account holder. */
const patientNameOf = (appointment) =>
  appointment?.childName || appointment?.resident?.fullname || "Unnamed patient";

module.exports = { visitLabels, patientNameOf };
