'use strict';
const Appointment = require('../../models/Appointment');
const Baby = require('../../models/Baby');
const Dose = require('../../models/ImmunizationDose');
const MedicalRecord = require('../../models/MedicalRecord');
const {forbidden,notFound} = require('../../utils/AppError');
const {assertValidObjectId} = require('../../utils/objectId');
const {ownsRecord} = require('../medicalRecord/residentRecordQuery');
const {todayManila} = require('./calendar');
const {getChecklist} = require('./checklistService');
const {visitDoseFilter} = require('./visitDoses');

const UNLINKED = {linked:false};

// Only the link stored when the visit was completed counts. Names and birth dates
// never choose a baby, so an older or ambiguous record simply stays unlinked.
const linkedVisit = async (record) => {
  if (record.serviceType !== 'immunization' || !record.serviceDetails?.ledgerSummary) return null;
  const babies = await Baby.find({'completedVisits.recordId':record._id}).select('motherMasterResidentId completedVisits').limit(2).lean();
  if (babies.length !== 1) return null;
  const [baby] = babies;
  const visit = baby.completedVisits.find(row => String(row.recordId) === String(record._id));
  if (String(visit.appointmentId) !== String(record.appointment)) return null;
  const appointment = await Appointment.findById(visit.appointmentId).select('slotStart').lean();
  return appointment?.slotStart ? {baby,visitDay:todayManila(appointment.slotStart)} : null;
};

const getVisitLedger = async (user,body) => {
  const id = assertValidObjectId(body.recordId,'medical record');
  const record = await MedicalRecord.findById(id).select('serviceType serviceDetails resident appointment source masterResidentId immunizationBabyId deletedImmunizationBabyId').lean();
  if (!record) throw notFound('This medical record is no longer available.');
  if (user.role === 'resident' && !(await ownsRecord(user.userId,record))) throw forbidden('You do not have permission to view this medical record.');
  const link = await linkedVisit(record);
  if (!link) return UNLINKED;
  // getChecklist reads the resident's verified identity fresh and refuses another mother's baby.
  const checklist = await getChecklist(user,{babyId:String(link.baby._id),motherMasterResidentId:link.baby.motherMasterResidentId});
  const stored = await Dose.find(visitDoseFilter(link.baby._id,link.visitDay)).select('doseKey').lean();
  // Limited to what this viewer's history holds, so a hidden void cannot show through.
  const visible = new Set(checklist.history.map(row => row.doseKey));
  return {linked:true,visitDay:link.visitDay,visitDoseKeys:stored.map(row => row.doseKey).filter(key => visible.has(key)),checklist};
};
module.exports = {getVisitLedger};
