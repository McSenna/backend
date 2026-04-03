"use strict";

const STEP_MINUTES = 5;

function parseHHMM(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToDate(baseDay, minutesFromMidnight) {
  const d = new Date(baseDay);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutesFromMidnight);
  return d;
}

function getMissionDayWindows(mission) {
  const d = new Date(mission.date);
  d.setHours(0, 0, 0, 0);
  const windows = [];
  const pairs = [
    [mission.morningStart, mission.morningEnd],
    [mission.afternoonStart, mission.afternoonEnd],
  ];
  for (const [startS, endS] of pairs) {
    const startM = parseHHMM(startS);
    const endM = parseHHMM(endS);
    if (startM == null || endM == null) continue;
    if (endM <= startM) continue;
    windows.push({ day: d, startM, endM });
  }
  return windows;
}

function isIntervalInsideWindows(windows, slotStart, slotEnd) {
  const startMs = slotStart.getTime();
  const endMs = slotEnd.getTime();
  if (endMs <= startMs) return false;
  for (const w of windows) {
    const wStart = minutesToDate(w.day, w.startM).getTime();
    const wEnd = minutesToDate(w.day, w.endM).getTime();
    if (startMs >= wStart && endMs <= wEnd) return true;
  }
  return false;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Returns true if [slotStart, slotEnd) conflicts with any booked appointment.
 */
function hasConflict(booked, slotStart, slotEnd, excludeAppointmentId) {
  const ex = excludeAppointmentId ? String(excludeAppointmentId) : null;
  const s = slotStart.getTime();
  const e = slotEnd.getTime();
  for (const ap of booked) {
    if (ex && String(ap._id) === ex) continue;
    if (!ap.slotStart || !ap.slotEnd) continue;
    const bs = new Date(ap.slotStart).getTime();
    const be = new Date(ap.slotEnd).getTime();
    if (intervalsOverlap(s, e, bs, be)) return true;
  }
  return false;
}

/**
 * Enumerate candidate start times every STEP_MINUTES within windows that fit duration.
 */
function listAvailableStarts(mission, bookedAppointments, durationMinutes, excludeAppointmentId) {
  const windows = getMissionDayWindows(mission);
  if (!windows.length) return [];
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = STEP_MINUTES * 60 * 1000;
  const candidates = [];

  for (const w of windows) {
    let t = minutesToDate(w.day, w.startM).getTime();
    const wEnd = minutesToDate(w.day, w.endM).getTime();
    while (t + durationMs <= wEnd) {
      const slotStart = new Date(t);
      const slotEnd = new Date(t + durationMs);
      if (
        isIntervalInsideWindows(windows, slotStart, slotEnd) &&
        !hasConflict(bookedAppointments, slotStart, slotEnd, excludeAppointmentId)
      ) {
        candidates.push(slotStart.toISOString());
      }
      t += stepMs;
    }
  }
  return candidates;
}

function suggestNextAvailableSlot(mission, bookedAppointments, durationMinutes, excludeAppointmentId) {
  const list = listAvailableStarts(mission, bookedAppointments, durationMinutes, excludeAppointmentId);
  return list[0] || null;
}

module.exports = {
  STEP_MINUTES,
  parseHHMM,
  getMissionDayWindows,
  isIntervalInsideWindows,
  hasConflict,
  listAvailableStarts,
  suggestNextAvailableSlot,
};
