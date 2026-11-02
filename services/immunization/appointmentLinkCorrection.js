"use strict";
const User = require("../../models/User");
const { verifiedAccountFilter } = require("./access");
const { badRequest } = require("../../utils/AppError");
// Called only inside midwife clinical completion after the exact baby and
// visit-day administration/deferral have been checked. Never infer legacy links.
const correctAppointmentRecipient = async (
  appointment,
  baby,
  mother,
  actor,
  session,
) => {
  if (
    !appointment.immunizationVisitKey ||
    String(appointment.immunizationBabyId) !== String(baby._id)
  )
    throw badRequest(
      "The appointment account must be verified and linked to the selected mother.",
    );
  const account = await User.findOneAndUpdate(
    verifiedAccountFilter(mother.masterResidentId),
    { $inc: { immunizationReminderFence: 1 } },
    { session, returnDocument: "after" },
  ).lean();
  if (!account)
    throw badRequest(
      "Verify the mother account link before completing this visit.",
    );
  appointment.immunizationAccountHistory.push({
    previous: appointment.resident,
    current: account._id,
    actor: actor.userId,
    at: new Date(),
    reason: "Verified parent identity link corrected at clinical completion",
  });
  appointment.resident = account._id;
  // Keep the original reservation identity: the corrected account may already
  // own a cancelled historical reservation for the same clinic week.
  // The resident field and explicit account history record the verified transfer.
};
module.exports = { correctAppointmentRecipient };
