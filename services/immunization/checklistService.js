'use strict';
const User = require('../../models/User');
const Dose = require('../../models/ImmunizationDose');
const VaccineSchedule = require('../../models/VaccineSchedule');
const MedicalRecord = require('../../models/MedicalRecord');
const Appointment = require('../../models/Appointment');
const {withAssignedVisits}=require('./appointmentPlan');
const {conflict} = require('../../utils/AppError');
const {loadContext,verifiedAccountFilter,nameOf,presentBaby} = require('./access');
const {buildDoseViews} = require('./checklist');
const {todayManila} = require('./calendar');
const residentView = require('./residentView');
const getChecklist = async (user,body) => {
  const {baby,mother} = await loadContext(user,body);
  const schedule = await VaccineSchedule.findOne({version:baby.scheduleVersion}).lean();
  if (!schedule) throw conflict('The saved vaccine schedule is unavailable. Contact the health center.');
  const account = await User.findOne(verifiedAccountFilter(mother.masterResidentId)).select('_id immunizationRemindersEnabled').lean();
  const isResident = user.role === 'resident';
  const stored = await Dose.find({babyId:baby._id}).sort({createdAt:1}).lean();
  // Filtered before any view is built, so a draft cannot influence a resident's statuses.
  const history = isResident ? residentView.forResidentRecords(stored) : stored;
  const appointments = await Appointment.find({immunizationBabyId:baby._id}).sort({createdAt:-1}).lean();
  const currentAppointments=appointments.filter(row=>account && String(row.resident)===String(account._id));
  const schedulingReviewRequired=appointments.some(row=>row.status==='processing' && (!account || String(row.resident)!==String(account._id)));
  const doses = withAssignedVisits(buildDoseViews(baby,schedule,history,todayManila()),currentAppointments,todayManila(),schedule.dueWindowDays);
  // Ambiguous legacy records remain in their original history. Names and dates
  // never assign them to a baby, including twins.
  const medicalRecord = require('./medicalRecordSummary').presentMedicalRecord(await MedicalRecord.findOne({immunizationBabyId:baby._id}).lean());
  const legacyReviewRequired = Boolean(await MedicalRecord.exists({immunizationBabyId:null,serviceType:'immunization',$or:[{masterResidentId:mother.masterResidentId},...(account ? [{resident:account._id}] : [])]}));
  const nextDates = doses.filter(dose => dose.status !== 'Administered' && dose.appointmentId).map(dose=>dose.scheduledOn).sort();
  const proposedDates = doses.filter(dose=>dose.status!=='Administered' && dose.slot!=='birth' && (dose.record?.state!=='void' || dose.record.followUpOn)).map(dose=>dose.proposedThursday).filter(Boolean).sort();
  const shared = {mother:{masterResidentId:mother.masterResidentId,name:nameOf(mother)},accountLinked:Boolean(account),remindersEnabled:Boolean(account && account.immunizationRemindersEnabled !== false),nextScheduledDate:nextDates[0] || null,nextProposedDate:proposedDates[0] || null,schedulingReviewRequired,legacyReviewRequired};
  if (isResident) return {...shared,medicalRecord:residentView.forResidentProgramRecord(medicalRecord),baby:residentView.forResidentBaby(presentBaby(baby)),schedule:residentView.forResidentSchedule(schedule),doses:residentView.forResidentDoseViews(doses),history:residentView.finalizedOnly(history)};
  return {...shared,medicalRecord,baby:presentBaby(baby),schedule,doses,history};
};
module.exports = {getChecklist};
