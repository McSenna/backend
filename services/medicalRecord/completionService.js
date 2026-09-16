"use strict";

const mongoose = require("mongoose");
const Appointment = require("../../models/Appointment");
const { COMPLETABLE_STATUSES, pushStatusHistory } = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const Notification = require("../../models/Notification");
const { getCategory } = require("../../config/consultationCategories");
const { conflict, notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { dispenseItems } = require("../inventoryService");

const buildRecordPayload = ({ appointment, providerId, providerRole, value, completedAt }) => ({
  resident: appointment.resident,
  appointment: appointment._id,
  provider: providerId,
  providerRole,
  serviceType: appointment.consultationType,
  assessment: value.assessment,
  findings: value.findings,
  diagnosis: value.diagnosis,
  recommendations: value.recommendations,
  notes: value.notes,
  serviceDetails: value.serviceDetails,
  followUpRequired: value.followUpRequired,
  followUpDate: value.followUpDate,
  appointmentDate: appointment.slotStart ?? appointment.createdAt,
  completedAt,
});

const completionNotification = (appointment, completedAt) => ({
  recipient: appointment.resident,
  appointment: appointment._id,
  type: "appointment_completed",
  title: "Appointment completed",
  body: `Your ${getCategory(appointment.consultationType)?.label ?? "appointment"} has been completed. Your medical record is now available.`,
  time: completedAt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),
  tone: "success",
});

const commitCompletion = async ({
  appointmentId,
  existing,
  validation,
  dispenseRequests,
  providerId,
  providerRole,
  completedAt,
}) => {
  const session = await mongoose.startSession();
  let recordId = null;
  let dispensed = [];

  try {
    await session.withTransaction(async () => {
      const appointment = await Appointment.findById(appointmentId).session(session);
      if (!appointment) {
        throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
      }
      if (!COMPLETABLE_STATUSES.includes(appointment.status)) {
        throw conflict(
          `An appointment that is ${appointment.status} cannot be completed.`,
          ERROR_CODES.INVALID_STATUS_TRANSITION
        );
      }

      const [record] = await MedicalRecord.create(
        [
          buildRecordPayload({
            appointment,
            providerId,
            providerRole,
            value: validation.value,
            completedAt,
          }),
        ],
        { session }
      );

      recordId = record._id;

      if (dispenseRequests.length > 0) {
        dispensed = await dispenseItems({
          requests: dispenseRequests,
          actor: { userId: providerId, role: providerRole },
          context: {
            appointmentId: appointment._id,
            patientId: appointment.resident,
            patientName: existing.resident?.fullname || "",
            medicalRecordId: record._id,
            serviceLabel: getCategory(appointment.consultationType)?.label || "",
          },
          session,
        });

        record.itemsGiven = dispensed.map((entry) => entry.recordEntry);
        await record.save({ session });
      }

      appointment.status = "completed";
      appointment.completedAt = completedAt;
      appointment.completedBy = providerId;
      appointment.medicalRecord = record._id;
      pushStatusHistory(appointment, "completed", providerId);
      await appointment.save({ session });

      await Notification.create([completionNotification(appointment, completedAt)], { session });
    });
  } finally {
    await session.endSession();
  }

  return { recordId, dispensed };
};

module.exports = { commitCompletion };
