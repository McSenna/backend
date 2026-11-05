'use strict';
const mongoose = require('mongoose');
const Appointment = require('../../models/Appointment');
const {pushStatusHistory,COMPLETABLE_STATUSES} = require('../../models/Appointment');
const Baby = require('../../models/Baby');
const Dose = require('../../models/ImmunizationDose');
const MedicalRecord = require('../../models/MedicalRecord');
const User = require('../../models/User');
const {assertMidwife,loadContext,verifiedAccountFilter} = require('./access');
const {todayManila} = require('./calendar');
const {assertValidObjectId} = require('../../utils/objectId');
const {badRequest,conflict,notFound} = require('../../utils/AppError');
const {assertCompletionDayReached} = require('../appointment/serviceDayRules');
const {visitDoseFilter} = require('./visitDoses');

const completeImmunizationVisit = async (user,body) => {
  assertMidwife(user);
  const appointmentId = assertValidObjectId(body.appointmentId,'appointment');
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const {baby,mother} = await loadContext(user,body,session);
      await Baby.updateOne({_id:baby._id},{$inc:{revision:1}},{session});
      const appointment = await Appointment.findById(appointmentId).session(session);
      if (!appointment) throw notFound('This appointment is unavailable. Refresh the queue.');
      if (appointment.consultationType !== 'immunization') throw badRequest('Choose an immunization appointment.');
      if (appointment.immunizationBabyId && String(appointment.immunizationBabyId)!==String(baby._id)) throw badRequest('This appointment is assigned to another baby. Select the correct baby.');
      const owner = await User.findOneAndUpdate({_id:appointment.resident,...verifiedAccountFilter(mother.masterResidentId)},{$inc:{immunizationReminderFence:1}},{session,returnDocument:'after'}).select('_id').lean();
      if (!owner && (appointment.status==='completed' || !appointment.immunizationBabyId)) throw badRequest('The appointment account must be verified and linked to the selected mother.');
      if (appointment.status === 'completed') {
        const record = await MedicalRecord.findOne({appointment:appointmentId}).session(session).lean();
        if (!baby.completedVisits?.some(visit=>String(visit.appointmentId) === String(appointment._id))) throw conflict('This visit was completed for another baby.');
        result = {appointment:appointment.toObject(),medicalRecord:record};
        return;
      }
      if (!COMPLETABLE_STATUSES.includes(appointment.status)) throw conflict('Only a scheduled or processing visit can be completed.');
      assertCompletionDayReached(appointment);
      const visitDay = todayManila(appointment.slotStart);
      const doses = await Dose.find(visitDoseFilter(baby._id,visitDay)).session(session).lean();
      if (!doses.length) throw conflict('Record this baby’s administered doses or documented deferral for the visit date in the checklist first.');
      if(!owner)await require('./appointmentLinkCorrection').correctAppointmentRecipient(appointment,baby,mother,user,session);
      const [record] = await MedicalRecord.create([{
        resident:appointment.resident,appointment:appointment._id,provider:user.userId,providerRole:'midwife',serviceType:'immunization',
        assessment:'Immunization visit documented in the baby checklist.',
        serviceDetails:{ledgerSummary:true},
        completedAt:new Date(),appointmentDate:appointment.slotStart,
      }],{session});
      await Baby.updateOne({_id:baby._id},{$push:{completedVisits:{appointmentId:appointment._id,recordId:record._id}}},{session});
      appointment.status='completed'; appointment.completedAt=new Date(); appointment.completedBy=user.userId; appointment.medicalRecord=record._id;
      pushStatusHistory(appointment,'completed',user.userId,'Completed from the baby immunization ledger');
      await appointment.save({session});
      result={appointment:appointment.toObject(),medicalRecord:record.toObject()};
    });
  } finally {await session.endSession();}
  return result;
};
module.exports = {completeImmunizationVisit};
