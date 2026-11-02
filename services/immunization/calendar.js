'use strict';
const { parseCalendarDate } = require('../../utils/calendarDate');
const DAY_MS = 86400000;
const requireDate = (value) => {
  const date = parseCalendarDate(value);
  if (!date) throw new RangeError('Use a real YYYY-MM-DD calendar date.');
  return date;
};
const keyOf = (date) => date.toISOString().slice(0, 10);
const todayManila = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get = (type) => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const addDays = (value, days) => keyOf(new Date(requireDate(value).getTime() + days * DAY_MS));
// Calendar anniversaries clamp to month end, including leap-day birthdays.
const addMonths = (value, months) => {
  const date = requireDate(value);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0));
  return keyOf(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(date.getUTCDate(), end.getUTCDate()))));
};
const ageOn = (birth, today = todayManila()) => {
  const born = requireDate(birth);
  const now = requireDate(today);
  if (now < born) throw new RangeError('Birth date cannot be in the future.');
  let months = (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + now.getUTCMonth() - born.getUTCMonth();
  if (addMonths(birth, months) > today) months -= 1;
  return {months,days:Math.round((now - requireDate(addMonths(birth, months))) / DAY_MS),weeks:Math.floor((now - born) / (DAY_MS * 7))};
};
const targetDate = (birth, slot) => Number.isInteger(slot.days) ? addDays(birth, slot.days) : addMonths(birth, slot.months);
module.exports = { todayManila, addDays, addMonths, ageOn, targetDate, requireDate };
