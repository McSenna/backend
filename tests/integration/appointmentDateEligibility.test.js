"use strict";

// Doctors cannot complete a visit, or file its medical record, before the
// visit's calendar day in Manila. Exercised through the real HTTP route.
const { createChecker, startHarness, createUser, localAt, finish, DAY_MS } = require("./helpers/appointmentHarness");
const Appointment = require("../../models/Appointment");
const MedicalRecord = require("../../models/MedicalRecord");
const Notification = require("../../models/Notification");
const { calendarDayIn } = require("../../utils/businessCalendar");
const { commitCompletion } = require("../../services/medicalRecord/completionService");
const { validateMedicalRecordInput } = require("../../utils/medicalRecordValidation");

const RECORD = { assessment: "Test assessment", serviceDetails: { chiefComplaint: "Test complaint" } };

(async () => {
  const { check, tally } = createChecker();
  const harness = await startHarness();
  const { request } = harness;

  try {
    const { user: resident } = await createUser("resident");
    const { user: doctor, token: doctorToken } = await createUser("doctor");
    const { token: midwifeToken } = await createUser("midwife");

    const today = calendarDayIn(new Date());
    const tomorrow = calendarDayIn(new Date(Date.now() + DAY_MS));
    const yesterday = calendarDayIn(new Date(Date.now() - DAY_MS));

    const visitOn = (dayKey, overrides = {}) =>
      Appointment.create({
        resident: resident._id,
        consultationType: "general_checkup",
        status: "confirmed",
        slotStart: dayKey ? localAt(dayKey, "15:00") : null,
        ageTier: 6,
        prioritySortKey: 6,
        ...overrides,
      });
    const complete = (id, body = RECORD, token = doctorToken) =>
      request(`/appointments/${id}/complete`, { method: "POST", token, body });
    const sideEffects = async (id) => ({
      records: await MedicalRecord.countDocuments({ appointment: id }),
      notices: await Notification.countDocuments({ appointment: id }),
      visit: JSON.stringify(await Appointment.findById(id).lean()),
    });

    console.log("\nFuture visits are refused");
    const future = await visitOn(tomorrow);
    const before = await sideEffects(future._id);
    const refused = await complete(future._id);
    check("tomorrow's visit is refused with 409", refused.status === 409, JSON.stringify(refused.body));
    check("the reason is machine readable", refused.body.code === "APPOINTMENT_DATE_NOT_REACHED");
    check("the scheduled date and zone come back", refused.body.scheduledDate === tomorrow && refused.body.timeZone === "Asia/Manila");
    check("the message says when it opens", /starting on/.test(refused.body.message ?? ""));
    const after = await sideEffects(future._id);
    check("no medical record was filed", after.records === 0);
    check("no completion notice was sent", after.notices === 0);
    check("the appointment is untouched", after.visit === before.visit);

    const forged = await complete(future._id, {
      ...RECORD,
      canComplete: true,
      isEligible: true,
      currentDate: tomorrow,
      timeZone: "Pacific/Kiritimati",
      slotStart: localAt(yesterday, "08:00").toISOString(),
      status: "completed",
    });
    check("forged dates, flags and zone in the body change nothing", forged.status === 409, JSON.stringify(forged.body));
    check("a forged request still leaves no record", (await sideEffects(future._id)).records === 0);

    const replay = await complete(future._id);
    check("a replayed request is checked again and refused", replay.status === 409);

    console.log("\nToday and past visits open");
    const lateToday = await visitOn(today, { slotStart: localAt(today, "23:59") });
    const done = await complete(lateToday._id);
    check("a visit later today can be completed now", done.status === 201, JSON.stringify(done.body));
    check("its record was filed", (await MedicalRecord.countDocuments({ appointment: lateToday._id })) === 1);

    const past = await visitOn(yesterday, { consultationType: "consultation", serviceDetails: undefined });
    const pastDone = await complete(past._id, { assessment: "Test", serviceDetails: { reasonForConsultation: "Test reason" } });
    check("yesterday's consultation can be completed", pastDone.status === 201, JSON.stringify(pastDone.body));

    console.log("\nExisting rules still apply once the day arrives");
    const wrongRole = await visitOn(today);
    const midwifeTry = await complete(wrongRole._id, RECORD, midwifeToken);
    check("a midwife still cannot complete a doctor's visit", midwifeTry.status === 403);
    const cancelled = await visitOn(today, { status: "cancelled" });
    check("a cancelled visit stays closed", (await complete(cancelled._id)).body.code === "INVALID_STATUS_TRANSITION");
    const pending = await visitOn(null, { status: "pending" });
    check("a queued visit with no date stays closed", (await complete(pending._id)).status === 409);
    const noDate = await visitOn(null);
    const noDateTry = await complete(noDate._id);
    check(
      "a placed visit missing its date is refused, not allowed",
      noDateTry.status === 409 && noDateTry.body.code === "APPOINTMENT_DATE_NOT_REACHED"
    );

    console.log("\nA reschedule between the check and the write cannot slip through");
    const racing = await visitOn(today);
    const staleCopy = (await Appointment.findById(racing._id).populate("resident", "fullname").lean());
    await Appointment.updateOne({ _id: racing._id }, { $set: { slotStart: localAt(tomorrow, "09:00"), status: "rescheduled" } });
    let raceError = null;
    try {
      await commitCompletion({
        appointmentId: racing._id,
        existing: staleCopy,
        validation: validateMedicalRecordInput("general_checkup", RECORD),
        dispenseRequests: [],
        providerId: doctor._id,
        providerRole: "doctor",
        completedAt: new Date(),
      });
    } catch (error) {
      raceError = error;
    }
    check("the transaction re-reads the new date and refuses", raceError?.code === "APPOINTMENT_DATE_NOT_REACHED", raceError?.message);
    const raced = await sideEffects(racing._id);
    check("the refused transaction left no record or notice", raced.records === 0 && raced.notices === 0);
    check("the moved visit is still open", JSON.parse(raced.visit).status === "rescheduled");
  } catch (error) {
    check("unexpected error", false, error.stack);
  }

  await finish(harness, tally);
})();
