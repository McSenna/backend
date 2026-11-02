"use strict";
const { requireDate, addDays, todayManila } = require("./calendar");
const { getCategory } = require("../../config/consultationCategories");
const { parseHHMM } = require("../../utils/slotAvailability");
const { buildDoseViews } = require("./checklist");
const nextThursday = (date) =>
  addDays(date, (4 - requireDate(date).getUTCDay() + 7) % 7);
const plannedVisits = (doses) => {
  const groups = new Map();
  for (const dose of doses) {
    if (
      dose.status === "Administered" ||
      (dose.record?.state === "void" && !dose.record.followUpOn)
    )
      continue;
    const targetOn = dose.record?.followUpOn || dose.targetOn;
    const thursday = nextThursday(targetOn);
    if (!groups.has(thursday))
      groups.set(thursday, { targetOn, thursday, doseKeys: [] });
    const group = groups.get(thursday);
    if (targetOn < group.targetOn) group.targetOn = targetOn;
    group.doseKeys.push(dose.key);
  }
  return [...groups.values()]
    .map((visit) => ({ ...visit, doseKeys: visit.doseKeys.sort() }))
    .sort((a, b) => a.targetOn.localeCompare(b.targetOn));
};
const withAssignedVisits = (doses, appointments, today, dueWindowDays) =>
  doses.map((dose) => {
    if (dose.status === "Administered") return dose;
    const eligible =
      dose.record?.state !== "void" || Boolean(dose.record.followUpOn);
    const anchor = nextThursday(dose.record?.followUpOn || dose.targetOn);
    // A clinical write may commit between assignment and reminder evaluation.
    // Ignore old reservations until they reflect the fresh clinical date.
    const visit =
      eligible &&
      appointments.find(
        (row) =>
          row.immunizationTargetOn &&
          nextThursday(row.immunizationTargetOn) === anchor &&
          ["confirmed", "rescheduled", "processing", "completed"].includes(
            row.status,
          ) &&
          row.immunizationDoseKeys?.includes(dose.key),
      );
    if (!visit?.slotStart)
      return {
        ...dose,
        proposedThursday:
          dose.slot === "birth"
            ? null
            : nextThursday(dose.record?.followUpOn || dose.targetOn),
      };
    const scheduledOn = todayManila(new Date(visit.slotStart));
    let status =
      scheduledOn > today
        ? "Upcoming"
        : today > addDays(scheduledOn, dueWindowDays)
          ? "Overdue"
          : "Due";
    if (dose.record?.state === "deferred") status = "Deferred";
    if (dose.status === "Requires review") status = "Requires review";
    return {
      ...dose,
      scheduledOn,
      status,
      appointmentId: String(visit._id),
      appointmentAt: visit.slotStart,
      proposedThursday: scheduledOn,
    };
  });
const clinicalVisits = (baby, schedule, records, day) =>
  plannedVisits(
    buildDoseViews(baby, schedule, records, day).filter(
      (dose) =>
        schedule.slots.find((slot) => slot.key === dose.slot)?.days !== 0,
    ),
  );
const positionsOn = (day) => {
  const category = getCategory("immunization");
  return category.serviceWindows.flatMap((window) => {
    const starts = [];
    for (
      let minute = parseHHMM(window.start);
      minute + category.durationMinutes <= parseHHMM(window.end);
      minute += category.durationMinutes
    )
      starts.push(
        new Date(new Date(`${day}T00:00:00+08:00`).getTime() + minute * 60000),
      );
    return starts;
  });
};
module.exports = {
  nextThursday,
  plannedVisits,
  withAssignedVisits,
  clinicalVisits,
  positionsOn,
};
