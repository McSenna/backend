'use strict';
const mongoose = require('mongoose');
const MedicalRecord = require('../../models/MedicalRecord');
const Baby = require('../../models/Baby');
const {assertValidObjectId} = require('../../utils/objectId');
const {badRequest,forbidden,notFound,conflict} = require('../../utils/AppError');
const {isAppointmentSource} = require('../../config/medicalRecordSources');
const {ownedServiceKeys,normalizeRole,assertMayWriteRecords} = require('./serviceOwnership');
const {canEdit} = require('./masterlistPresenter');

const assertMayDelete = (record,user) => {
 const role = normalizeRole(user);
 if (!ownedServiceKeys(user).includes(record.serviceType)) throw forbidden('You do not have permission to access this medical record.');
 if (record.serviceType === 'immunization' && role !== 'midwife') throw forbidden('Only a midwife may delete immunization records.');
 if (record.immunizationBabyId || record.deletedImmunizationBabyId) return;
 if (isAppointmentSource(record.source)) {
  if (String(record.provider) === String(user.userId)) return;
 } else if (canEdit(record,user)) return;
 throw forbidden('Only the responsible clinical staff member may delete this medical record.');
};

// This is an audited removal from normal views, never a purge of clinical data.
const deleteMedicalRecord = async (user,body = {}) => {
 assertMayWriteRecords(user);
 const recordId = assertValidObjectId(body.recordId,'medical record');
 const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
 if (!reason || reason.length > 500) throw badRequest('Enter a deletion reason of at most 500 characters.');
 const expected = typeof body.expectedUpdatedAt === 'string' ? new Date(body.expectedUpdatedAt) : new Date(NaN);
 if (Number.isNaN(expected.getTime())) throw badRequest('Reload the record before deleting it.');
 const role = normalizeRole(user);
 const session = await mongoose.startSession();
 let deleted = false;
 try {
  await session.withTransaction(async () => {
   deleted = false;
   const record = await MedicalRecord.findById(recordId).withDeleted().session(session).lean();
   if (!record) throw notFound('Medical record not found.');
   assertMayDelete(record,user);
   if (record.deletedAt) return;
   if (!record.updatedAt || record.updatedAt.getTime() !== expected.getTime()) throw conflict('This medical record has changed. Reload before deleting it.');
   // Serialize removal with dose saves and startup backfills using their Baby fence.
   if (record.immunizationBabyId) await Baby.updateOne({_id:record.immunizationBabyId},{$inc:{revision:1}},{session});
   const now = new Date();
   const values = {deletedAt:now,deletedBy:user.userId,deletedByRole:role,deletionReason:reason,updatedBy:user.userId,updatedByRole:role};
   const changes = [{field:'deletedAt',previous:null}];
   const update = {$set:values,$push:{revisions:{editedBy:user.userId,editedByRole:role,editedAt:now,reason,changes}}};
   if (record.immunizationBabyId) {
    values.deletedImmunizationBabyId = record.immunizationBabyId;
    update.$unset = {immunizationBabyId:1};
    changes.push({field:'immunizationBabyId',previous:record.immunizationBabyId});
   }
   const saved = await MedicalRecord.findOneAndUpdate({_id:record._id,updatedAt:expected},update,{session,returnDocument:'after',runValidators:true});
   if (!saved) throw conflict('This medical record has changed. Reload before deleting it.');
   deleted = true;
  });
 } finally {await session.endSession();}
 return {recordId,deleted};
};
module.exports = {deleteMedicalRecord};
