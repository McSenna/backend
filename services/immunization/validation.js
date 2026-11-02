'use strict';
const {badRequest} = require('../../utils/AppError');
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
const draftAdministrationFields = (baby,body) => {
  const rawDate = text(body.administeredOn,'Administration date',10);
  const administeredOn = rawDate ? calendarInput(rawDate,'Administration date') : '';
  if (administeredOn && (administeredOn < baby.dateOfBirth || administeredOn > todayManila())) throw badRequest('Administration date must be on or after birth and cannot be in the future.');
  if (body.historical !== undefined && typeof body.historical !== 'boolean') throw badRequest('Historical documentation must be true or false.');
  const historical = body.historical === true;
  const clinician = text(body.administeredBy,'Administering clinician',120);
  const administeredAt = text(body.administeredAt,'Administration time',5);
  if (administeredAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(administeredAt)) throw badRequest('Use HH:mm for administration time.');
  return {administeredOn,administeredAt,historical,administeredBy:clinician,facility:text(body.facility,'Facility',160),lotNumber:text(body.lotNumber,'Lot number',120),route:text(body.route,'Route',80),site:text(body.site,'Site',120),remarks:text(body.remarks,'Remarks',2000)};
};
const administrationFields = async (user,baby,vaccine,body) => {
  const fields = draftAdministrationFields(baby,body);
  if (!fields.administeredOn) throw badRequest('Administration date is required.');
  if (fields.historical && !fields.administeredBy) throw badRequest('Administering clinician is required for historical documentation.');
  const recorder = await User.findById(user.userId).select('fullname').lean();
  return {...fields,administeredBy:fields.administeredBy || recorder.fullname,recordedBy:user.userId,route:fields.route || vaccine.route};
};
module.exports = {text,calendarInput,administrationFields,draftAdministrationFields};
