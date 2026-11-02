'use strict';
const { targetDate, addDays } = require('./calendar');
const buildDoseViews = (baby, schedule, records, today) => {
  const byDose = new Map(records.map(record => [record.doseKey,record]));
  return schedule.vaccines.flatMap(vaccine => vaccine.doses.map(dose => {
    const slot = schedule.slots.find(item => item.key === dose.slot);
    const targetOn = targetDate(baby.dateOfBirth, slot);
    const record = byDose.get(dose.key) ?? null;
    const scheduledOn = record?.followUpOn || targetOn;
    const reviewRequired = Boolean(record?.historical || record?.state === 'void' || scheduledOn < today || record?.reviewRequired);
    let status = 'Upcoming';
    if (scheduledOn <= today) status = today > addDays(scheduledOn, schedule.dueWindowDays) ? 'Overdue' : 'Due';
    if (schedule.activationStatus !== 'active') status = 'Requires review';
    if (record?.state === 'void' && !record.followUpOn) status = 'Requires review';
    if (record?.state === 'deferred') status = 'Deferred';
    if (record?.state === 'administered') status = 'Administered';
    return {key:dose.key,vaccineKey:vaccine.key,label:dose.label,slot:dose.slot,targetOn,scheduledOn,status,reviewRequired,record};
  }));
};
module.exports = { buildDoseViews };
