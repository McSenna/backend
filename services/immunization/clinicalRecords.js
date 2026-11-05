'use strict';
const mongoose = require('mongoose');
const Baby = require('../../models/Baby');
const Dose = require('../../models/ImmunizationDose');
const VaccineSchedule = require('../../models/VaccineSchedule');
const {assertMidwife,loadContext} = require('./access');
const {administrationFields,calendarInput,text} = require('./validation');
const {targetDate,todayManila} = require('./calendar');
const {assertRevision} = require('./doseRevision');
const {badRequest,conflict} = require('../../utils/AppError');

const inBabyTransaction = async (user,body,operation,{clinicalChange = true} = {}) => {
  assertMidwife(user);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const {baby} = await loadContext(user,body,session);
      // Every clinical write and reminder delivery touches the same baby. A
      // concurrent save retries on a fresh snapshot instead of sending stale care.
      await Baby.updateOne({_id:baby._id},{$inc:{revision:1}},{session});
      const schedule = await VaccineSchedule.findOne({version:baby.scheduleVersion}).session(session).lean();
      if (!schedule) throw conflict('The saved schedule version is unavailable. Contact the administrator.');
      const doseKey = text(body.doseKey,'Vaccine dose',80,true);
      const vaccine = schedule.vaccines.find(item => item.doses.some(dose => dose.key === doseKey));
      if (!vaccine) throw badRequest('Choose an existing vaccine and scheduled dose.');
      const dose = vaccine.doses.find(item => item.key === doseKey);
      const slot = schedule.slots.find(item => item.key === dose.slot);
      const current = await Dose.findOne({babyId:baby._id,doseKey}).session(session);
      await operation({baby,schedule,doseKey,vaccine,current,slot,session});
      await require('./medicalRecordSummary').syncImmunizationMedicalRecord(baby,schedule,user,session);
      // Keep cancellation in the same transaction as the clinical change.
      if (clinicalChange) await require('./reminderWorker').cancelPendingForBaby(baby._id,session);
    });
  } catch (error) {
    if (error.code === 11000) throw conflict('This dose has already been recorded. Reload the checklist.');
    throw error;
  } finally {await session.endSession();}
};
const previousValue = (current) => {
  if (!current) return null;
  const {history,_id,__v, ...snapshot} = current.toObject();
  return snapshot;
};
const audit = (user,action,reason,current) => ({action,reason,actor:user.userId,at:new Date(),previous:previousValue(current)});
const saveAdministration = (user,body) => inBabyTransaction(user,body,async ({baby,doseKey,vaccine,current,slot,session}) => {
  if (current?.state === 'administered') throw conflict('This dose is already administered. Use a correction with a reason.');
  if (current?.workflowStatus === 'draft') assertRevision(current,body.expectedRevision);
  const values = await administrationFields(user,baby,vaccine,body);
  const targetOn = targetDate(baby.dateOfBirth,slot);
  values.reviewRequired = values.historical || values.administeredOn !== targetOn;
  if (!current) {
    await Dose.create([{...values,babyId:baby._id,doseKey,scheduleVersion:baby.scheduleVersion,state:'administered',workflowStatus:'completed',createdBy:user.userId,updatedBy:user.userId,history:[audit(user,'administered','Initial administration record',null)]}],{session});
  } else {
    current.history.push(audit(user,'administered',current.workflowStatus === 'draft' ? 'Completed draft' : current.state === 'void' ? 'New entry after void; source must be reviewed' : 'Administered after deferral',current));
    current.set({...values,state:'administered',workflowStatus:'completed',updatedBy:user.userId,followUpOn:undefined,reason:undefined,revision:current.revision+1});
    await current.save({session});
  }
});
const correctAdministration = (user,body) => inBabyTransaction(user,body,async ({baby,vaccine,current,slot,session}) => {
  const reason = text(body.reason,'Correction reason',500,true);
  if (!['void','correct'].includes(body.action)) throw badRequest('Choose correct or void.');
  if (!Number.isInteger(body.expectedRevision)) throw badRequest('Reload the record before correcting it.');
  if (!current || current.state !== 'administered' || current.revision !== body.expectedRevision) throw conflict('This record has changed. Reload before correcting it.');
  const event = audit(user,body.action,reason,current);
  if (body.action === 'correct') {
    const values = await administrationFields(user,baby,vaccine,body.administration || {},current);
    values.reviewRequired = values.historical || values.administeredOn !== targetDate(baby.dateOfBirth,slot);
    current.set(values);
  } else current.set({state:'void',reviewRequired:true,followUpOn:undefined});
  current.reason = reason;
  current.recordedBy = user.userId;
  current.updatedBy = user.userId;
  current.workflowStatus = 'completed';
  current.revision += 1;
  current.history.push(event);
  await current.save({session});
});
const saveFollowUp = (user,body) => inBabyTransaction(user,body,async ({baby,doseKey,current,session}) => {
  if (current?.state === 'administered') throw conflict('This dose is already administered. Correct it before changing follow-up.');
  const followUpOn = calendarInput(body.followUpOn,'Follow-up date');
  if (followUpOn < todayManila() || followUpOn < baby.dateOfBirth) throw badRequest('Choose today or a later follow-up date.');
  if (typeof body.deferred !== 'boolean') throw badRequest('Specify whether this dose is deferred.');
  const reason = text(body.reason,'Follow-up reason',500,true);
  const values = {followUpOn,reason,workflowStatus:current?.workflowStatus === 'draft' ? 'draft' : 'completed',updatedBy:user.userId,state:body.deferred ? 'deferred' : 'void',recordedBy:user.userId,reviewRequired:true};
  if (current) {
    current.history.push(audit(user,'follow_up',reason,current));
    current.set({...values,revision:current.revision+1});
    await current.save({session});
  } else await Dose.create([{...values,createdBy:user.userId,babyId:baby._id,doseKey,scheduleVersion:baby.scheduleVersion,history:[audit(user,'follow_up',reason,null)]}],{session});
});
module.exports = {saveAdministration,correctAdministration,saveFollowUp,inBabyTransaction,audit};
