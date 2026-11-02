'use strict';
const {createHash} = require('node:crypto');
// Historical lead-time stages are not replayed after linkage. Previously
// delivered overdue dose keys are kept in their original notice; only newly
// overdue doses create another notice, coalesced for late registration.
const planReminderVisits = (doses,today,reminderDays = [7,1,0],dueWindowDays = 0,deliveredOverdue = []) => {
  const groups = new Map();
  const overdue = [];
  for (const dose of doses) {
    if (dose.status === 'Administered' || (dose.status === 'Requires review' && !dose.record?.followUpOn) || !dose.scheduledOn) continue;
    const days = Math.round((Date.parse(dose.scheduledOn)-Date.parse(today))/86400000);
    if (!Number.isFinite(days)) continue;
    if (days < -dueWindowDays) {overdue.push(dose);continue;}
    if (days < 0 || !reminderDays.includes(days)) continue;
    const visitKey = dose.scheduledOn;
    if (!groups.has(visitKey)) groups.set(visitKey,{visitKey,scheduledOn:dose.scheduledOn,stage:String(days),doseKeys:[]});
    groups.get(visitKey).doseKeys.push(dose.key);
  }
  const covered = new Set();
  for (const old of deliveredOverdue) {
    const originalVisits = old.doseVisits?.length ? old.doseVisits : old.doseKeys.map(key=>({key,scheduledOn:old.scheduledOn}));
    const originalKeys = new Set(originalVisits.map(visit=>`${visit.key}@${visit.scheduledOn}`));
    const remaining = overdue.filter(dose => originalKeys.has(`${dose.key}@${dose.scheduledOn}`) && !covered.has(`${dose.key}@${dose.scheduledOn}`));
    originalKeys.forEach(key => covered.add(key));
    if (remaining.length) groups.set(old.visitKey,{visitKey:old.visitKey,scheduledOn:remaining.map(dose=>dose.scheduledOn).sort()[0],stage:'overdue',doseKeys:remaining.map(dose=>dose.key),doseVisits:originalVisits});
  }
  const fresh = overdue.filter(dose=>!covered.has(`${dose.key}@${dose.scheduledOn}`));
  if (fresh.length) {
    const doseKeys = fresh.map(dose=>dose.key).sort();
    const hash = createHash('sha256').update(fresh.map(dose=>`${dose.key}@${dose.scheduledOn}`).sort().join('\n')).digest('hex');
    const visitKey = `overdue-${hash}`;
    groups.set(visitKey,{visitKey,scheduledOn:fresh.map(dose=>dose.scheduledOn).sort()[0],stage:'overdue',doseKeys,doseVisits:fresh.map(dose=>({key:dose.key,scheduledOn:dose.scheduledOn}))});
  }
  return [...groups.values()].map(visit=>({...visit,doseKeys:visit.doseKeys.sort()})).sort((a,b)=>a.scheduledOn.localeCompare(b.scheduledOn));
};
module.exports = {planReminderVisits};
