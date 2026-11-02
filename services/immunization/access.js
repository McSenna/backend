'use strict';
const User = require('../../models/User');
const {registryIdentity} = require('../masterList/medicalIdentityLookup');
const Baby = require('../../models/Baby');
const { forbidden, notFound, badRequest } = require('../../utils/AppError');
const { assertValidObjectId } = require('../../utils/objectId');
const { todayManila, ageOn } = require('./calendar');
const verifiedAccountFilter = (masterResidentId) => ({
  masterResidentId,role:'resident',verified:true,status:{$in:['approved','active']},verificationMethod:{$in:['master_list','admin_review']},
});
const assertMidwife = (user) => {
  if (user?.role !== 'midwife') throw forbidden('Only an authenticated midwife can change immunization records.');
};
const motherIdentity = async (user, suppliedId, session = null) => {
  let id = suppliedId;
  if (user.role === 'resident') {
    const account = await User.findOne({_id:user.userId,...verifiedAccountFilter({$type:'string'})}).session(session).lean();
    if (!account?.masterResidentId) throw forbidden('A verified patient identity link is required. Contact the health center.');
    id = account.masterResidentId;
  } else assertMidwife(user);
  if (typeof id !== 'string' || !id.trim()) throw badRequest('Choose the mother from the patient registry.');
  const mother = await registryIdentity(id,session);
  if (!mother) throw notFound('The selected patient is not available. Refresh the patient list.');
  return mother;
};
const loadContext = async (user, body, session = null) => {
  const mother = await motherIdentity(user,body.motherMasterResidentId,session);
  const babyId = assertValidObjectId(body.babyId,'baby');
  const baby = await Baby.findOne({_id:babyId,motherMasterResidentId:mother.masterResidentId}).session(session).lean();
  if (!baby) {
    if (user.role === 'resident') throw forbidden('This baby is not linked to your verified patient identity.');
    throw notFound('Choose a baby linked to the selected mother.');
  }
  return {mother,baby};
};
const nameOf = (mother) => [mother.firstName,mother.middleName,mother.lastName,mother.suffix].filter(Boolean).join(' ');
const presentBaby = (baby) => ({...baby,_id:String(baby._id),age:ageOn(baby.dateOfBirth,todayManila())});
module.exports = {assertMidwife,motherIdentity,loadContext,verifiedAccountFilter,nameOf,presentBaby};
