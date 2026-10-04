"use strict";

// Fields for records that staff encode rather than complete through an
// appointment: paper records from before MaslogCare, walk-ins and mission
// visits. They belong to a Barangay Master List identity, not to an account.

const mongoose = require("mongoose");
const { ALL_SOURCES, MEDICAL_RECORD_SOURCES, isAppointmentSource } = require("../../config/medicalRecordSources");

const STAFF_ROLES = ["doctor", "midwife", "bhw", "admin"];

function isEncoded() {
  return !isAppointmentSource(this.source);
}

// Earlier values of the fields an edit changed. They stay inside this protected
// collection; system logs only ever get the field names.
const RevisionSchema = new mongoose.Schema(
  {
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    editedByRole: { type: String, enum: STAFF_ROLES, required: true },
    editedAt: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    changes: {
      type: [
        new mongoose.Schema(
          { field: { type: String, required: true }, previous: { type: mongoose.Schema.Types.Mixed } },
          { _id: false }
        ),
      ],
      default: () => [],
    },
  },
  { _id: false }
);

const encodedFields = {
  source: {
    type: String,
    enum: ALL_SOURCES,
    default: MEDICAL_RECORD_SOURCES.APPOINTMENT,
    index: true,
  },

  // The Barangay Master List identity an encoded record belongs to. The account
  // that holds this ID (User.masterResidentId) sees the record; nothing is
  // copied onto the record when an account links or unlinks.
  masterResidentId: {
    type: String,
    trim: true,
    maxlength: 40,
    required: [isEncoded, "A master list resident is required for an encoded record"],
  },

  // The person named on the paper record, who may never have had an account.
  providerName: { type: String, default: "", trim: true, maxlength: 120 },
  visitReason: { type: String, default: "", trim: true, maxlength: 500 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdByRole: { type: String, enum: [...STAFF_ROLES, null], default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  updatedByRole: { type: String, enum: [...STAFF_ROLES, null], default: null },

  // Staff saw the possible-duplicate warning and saved anyway.
  duplicateAcknowledged: { type: Boolean, default: false },

  // Retry key from the encoding form, so a double submit saves one record.
  requestKey: { type: String, default: null, maxlength: 64 },

  revisions: { type: [RevisionSchema], default: () => [] },
};

module.exports = { encodedFields, STAFF_ROLES };
