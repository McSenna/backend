"use strict";

const Appointment = require("../../models/Appointment");
const asyncHandler = require("../../utils/asyncHandler");
const { assertValidObjectId } = require("../../utils/objectId");
const { notFound, forbidden } = require("../../utils/AppError");
const { ERROR_CODES, HTTP_STATUS } = require("../../utils/errorCodes");
const { createSystemLog } = require("../../services/systemLogService");
const { evaluateStockAlerts } = require("../../services/inventoryService");
const { can } = require("../../config/inventoryPermissions");
const {
  assertMayComplete,
  normalizeRole,
} = require("../../services/medicalRecord/serviceOwnership");
const { commitCompletion } = require("../../services/medicalRecord/completionService");
const {
  alreadyCompletedResponse,
  assertCompletable,
  validateSubmission,
  loadCompletedPair,
} = require("./completionGuards");
const {
  buildDispensedSummary,
  buildDispensedSentence,
  buildInventoryTransactions,
} = require("../../services/medicalRecord/completionSummary");

exports.completeAppointment = asyncHandler(async (req, res) => {
  const id = assertValidObjectId(req.params.id, "appointment");

  const existing = await Appointment.findById(id).populate("resident", "fullname").lean();
  if (!existing) {
    throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
  }

  assertMayComplete(req.user, existing.consultationType);

  if (existing.status === "completed") {
    return alreadyCompletedResponse(res, existing._id, existing);
  }

  assertCompletable(existing.status);

  const { validation, dispense } = validateSubmission(existing.consultationType, req.body);

  const completedAt = new Date();
  const providerId = req.user.userId;
  const providerRole = normalizeRole(req.user);

  if (dispense.value.length > 0 && !can(providerRole, "stockOut")) {
    throw forbidden("You do not have permission to dispense inventory items.");
  }

  let recordId = null;
  let dispensed = [];

  try {
    ({ recordId, dispensed } = await commitCompletion({
      appointmentId: id,
      existing,
      validation,
      dispenseRequests: dispense.value,
      providerId,
      providerRole,
      completedAt,
    }));
  } catch (error) {
    if (error?.code === 11000) {
      const appointment = await Appointment.findById(id).lean();
      return alreadyCompletedResponse(res, id, appointment);
    }
    throw error;
  }

  const [appointment, medicalRecord] = await loadCompletedPair(id, recordId);

  for (const entry of dispensed) {
    void evaluateStockAlerts(entry.item);
  }

  const dispensedSummary = buildDispensedSummary(dispensed);

  void createSystemLog({
    req,
    action: "APPOINTMENT_COMPLETED",
    user: { _id: providerId, role: providerRole },
    role: providerRole,
    description: `Health worker completed an appointment and filed a medical record${buildDispensedSentence(dispensedSummary)}`,
    resource: "Appointment",
    resourceId: String(id),
    metadata: {
      serviceType: existing.consultationType,
      medicalRecordId: String(recordId),
      residentId: String(existing.resident?._id ?? existing.resident),
      completedAt: completedAt.toISOString(),
      followUpRequired: validation.value.followUpRequired,
      itemsDispensed: dispensedSummary,
    },
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: dispensedSummary.length
      ? "Appointment completed, medical record saved and inventory updated."
      : "Appointment completed and medical record saved.",
    appointment,
    medicalRecord,
    inventoryTransactions: buildInventoryTransactions(dispensed),
  });
});
