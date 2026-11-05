'use strict';
const {badRequest,forbidden} = require('../../utils/AppError');
const {IMMUNIZATION_LOCATION} = require('../../config/healthCenter');
const {requireDate,todayManila} = require('./calendar');
const User = require('../../models/User');
const text = (value,label,max,required = false) => {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw badRequest(`${label} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw badRequest(`${label} is required and must be at most ${max} characters.`);
  return result;
};
const calendarInput = (value,label) => {
  const date = text(value,label,10,true);
  try {requireDate(date);} catch {throw badRequest(`${label} must be a real YYYY-MM-DD date.`);}
  return date;
};
const clinicalFields = (baby,body) => {
  const rawDate = text(body.administeredOn,'Administration date',10);
  const administeredOn = rawDate ? calendarInput(rawDate,'Administration date') : '';
  if (administeredOn && (administeredOn < baby.dateOfBirth || administeredOn > todayManila())) throw badRequest('Administration date must be on or after birth and cannot be in the future.');
  if (body.historical !== undefined && typeof body.historical !== 'boolean') throw badRequest('Historical documentation must be true or false.');
  const historical = body.historical === true;
  const clinician = text(body.administeredBy,'Administering clinician',120);
  const administeredAt = text(body.administeredAt,'Administration time',5);
  if (administeredAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(administeredAt)) throw badRequest('Use HH:mm for administration time.');
  return {administeredOn,administeredAt,historical,administeredBy:clinician,facility:text(body.facility,'Facility',160),lotNumber:text(body.lotNumber,'Lot number',120),route:text(body.route,'Route',80),site:text(body.site,'Site',120),remarks:text(body.remarks,'Remarks',2000),immediateReaction:text(body.immediateReaction,'Immediate reaction',2000),aefi:text(body.aefi,'Adverse event following immunization',2000)};
};
// A draft claims no clinician or location: those are set when the dose is finalized.
// Only a dose copied from an earlier record keeps what that record says.
const draftAdministrationFields = (baby,body) => {
  const fields = clinicalFields(baby,body);
  return fields.historical ? fields : {...fields,administeredBy:'',facility:''};
};
const signedInClinician = async (user) => {
  const account = await User.findById(user.userId).select('fullname').lean();
  const name = account?.fullname?.trim();
  if (!name) throw forbidden('Your account has no name on file. Ask an administrator to update it before recording a dose.');
  return name;
};
// Clinician and location never come from the request, so a client cannot record a dose as
// someone else. A historical dose was given elsewhere, so it keeps the earlier record's
// values; a correction keeps who gave the dose, and the editor goes in updatedBy and the audit.
const administrationFields = async (user,baby,vaccine,body,saved = null) => {
  const fields = clinicalFields(baby,body);
  if (!fields.administeredOn) throw badRequest('Administration date is required.');
  const name = await signedInClinician(user);
  const common = {...fields,recordedBy:user.userId,route:fields.route || vaccine.route};
  if (fields.historical) {
    if (!fields.administeredBy) throw badRequest('Administering clinician is required for historical documentation.');
    return common;
  }
  const keepsSaved = saved?.state === 'administered' && !saved.historical;
  return keepsSaved
    ? {...common,administeredBy:saved.administeredBy,facility:saved.facility}
    : {...common,administeredBy:name,facility:IMMUNIZATION_LOCATION};
};
module.exports = {text,calendarInput,administrationFields,draftAdministrationFields};
