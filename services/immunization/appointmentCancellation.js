"use strict";
const mongoose = require("mongoose");
const Appointment = require("../../models/Appointment");
const Baby = require("../../models/Baby");
const User = require("../../models/User");
const { pushStatusHistory } = require("../../models/Appointment");
const { verifiedAccountFilter } = require("./access");
const { forbidden, notFound } = require("../../utils/AppError");
const {
  CANCELLABLE_STATUSES,
  assertOwnership,
  assertStatusAllows,
} = require("../residentAppointment/shared");

const markCancelled = (appointment, residentId, reason) => {
  appointment.status = "cancelled";
  appointment.cancelReason = reason;
  if (appointment.immunizationBabyId)
    appointment.immunizationCancellationOrigin = "resident";
  appointment.missionSchedule = null;
  appointment.slotStart = null;
  appointment.slotEnd = null;
  appointment.assignedCategoryKey = null;
  appointment.assignedDurationMinutes = null;
  appointment.immunizationSlotKey = null;
  pushStatusHistory(
    appointment,
    "cancelled",
    residentId,
    reason || "Cancelled by resident",
  );
};

const cancelAutomaticVisit = async ({
  appointmentId,
  residentId,
  actorRole,
  reason,
}) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const appointment =
        await Appointment.findById(appointmentId).session(session);
      if (!appointment) throw notFound("Appointment not found.");
      assertOwnership(appointment, residentId, actorRole, "cancel");
      // Serialize against assignment, clinical writes and reminder delivery.
      const baby = await Baby.findOneAndUpdate(
        { _id: appointment.immunizationBabyId },
        { $inc: { revision: 1 } },
        { session, returnDocument: "after" },
      ).lean();
      const account =
        baby &&
        (await User.findOneAndUpdate(
          {
            _id: appointment.resident,
            ...verifiedAccountFilter(baby.motherMasterResidentId),
          },
          { $inc: { immunizationReminderFence: 1 } },
          { session, returnDocument: "after" },
        ).lean());
      if (!account)
        throw forbidden(
          "This appointment is not linked to your verified patient identity.",
        );
      if (appointment.status === "cancelled") {
        result = { appointment, alreadyCancelled: true };
        return;
      }
      assertStatusAllows(appointment, CANCELLABLE_STATUSES, "cancelled");
      markCancelled(appointment, residentId, reason);
      await appointment.save({ session });
      await require("./reminderWorker").cancelPendingForBaby(baby._id, session);
      result = { appointment, alreadyCancelled: false };
    });
    return result;
  } finally {
    await session.endSession();
  }
};
module.exports = { markCancelled, cancelAutomaticVisit };
