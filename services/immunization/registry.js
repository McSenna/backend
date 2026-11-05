'use strict';
const mongoose = require('mongoose');
const Baby = require('../../models/Baby');
const {searchIdentities} = require('../masterList/medicalIdentityLookup');
const VaccineSchedule = require('../../models/VaccineSchedule');
const { badRequest, conflict } = require('../../utils/AppError');
const { assertMidwife, motherIdentity, loadContext, nameOf, presentBaby } = require('./access');
const { todayManila, requireDate } = require('./calendar');
const { INITIAL_SCHEDULE } = require('./scheduleDefinition');
const { text } = require('./validation');
const { forResidentBaby } = require('./residentView');
const ensureInitialSchedule = async () => {
  try {
    return await VaccineSchedule.findOneAndUpdate({version:INITIAL_SCHEDULE.version},{$setOnInsert:INITIAL_SCHEDULE},{upsert:true,returnDocument:'after'}).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return VaccineSchedule.findOne({version:INITIAL_SCHEDULE.version}).lean();
  }
};
const searchMothers = async (user, body) => {
  assertMidwife(user);
  const query = text(body.query,'Patient search',80,true);
  if (query.length < 2) return [];
  const identities = await searchIdentities(query);
  return identities.map(identity => ({masterResidentId:identity.masterResidentId,name:identity.fullName}));
};
const listBabies = async (user, body) => {
  const mother = await motherIdentity(user,body.motherMasterResidentId);
  const babies = (await Baby.find({motherMasterResidentId:mother.masterResidentId}).sort({dateOfBirth:-1,_id:1}).lean()).map(presentBaby);
  return user.role === 'resident' ? babies.map(forResidentBaby) : babies;
};
const createBaby = async (user, body) => {
  assertMidwife(user);
  const mother = await motherIdentity(user,body.motherMasterResidentId);
  const dateOfBirth = text(body.dateOfBirth,'Birth date',10,true);
  try {requireDate(dateOfBirth);} catch {throw badRequest('Use a real YYYY-MM-DD birth date.');}
  if (dateOfBirth > todayManila()) throw badRequest('Birth date cannot be in the future.');
  const requestKey = text(body.requestKey,'Birth request key',64,true);
  const existing = await Baby.findOne({createdBy:user.userId,requestKey}).lean();
  if (existing) {
    if (existing.motherMasterResidentId !== mother.masterResidentId || existing.dateOfBirth !== dateOfBirth) throw conflict('This request key belongs to another birth entry. Start a new entry.');
    return {baby:presentBaby(existing),created:false};
  }
  const schedule = await ensureInitialSchedule();
  const active = await VaccineSchedule.findOne({activationStatus:'active',effectiveOn:{$lte:todayManila()}}).sort({effectiveOn:-1,version:-1}).lean();
  const id = new mongoose.Types.ObjectId();
  const name = text(body.name,'Baby name',120);
  const values = {_id:id,motherMasterResidentId:mother.masterResidentId,dateOfBirth,requestKey,name:name || `Temporary newborn ${String(id).slice(-8).toUpperCase()}`,temporaryName:!name,createdBy:user.userId,scheduleVersion:active?.version || schedule.version,birthRecordId:text(body.birthRecordId,'Birth record reference',120)};
  try {return {baby:presentBaby((await Baby.create(values)).toObject()),created:true};}
  catch (error) {
    if (error.code !== 11000) throw error;
    const first = await Baby.findOne({createdBy:user.userId,requestKey}).lean();
    if (!first || first.motherMasterResidentId !== mother.masterResidentId || first.dateOfBirth !== dateOfBirth) throw conflict('This birth request was already used. Start a new entry.');
    return {baby:presentBaby(first),created:false};
  }
};
const renameBaby = async (user, body) => {
  assertMidwife(user);
  const {baby} = await loadContext(user,body);
  const name = text(body.name,'Baby name',120,true);
  const updated = await Baby.findOneAndUpdate({_id:baby._id,revision:baby.revision},{$set:{name,temporaryName:false},$inc:{revision:1},$push:{nameHistory:{name:baby.name,actor:user.userId,at:new Date()}}},{returnDocument:'after'}).lean();
  if (!updated) throw conflict('This baby was updated. Reload before saving the name.');
  return presentBaby(updated);
};
module.exports = {searchMothers,listBabies,createBaby,renameBaby,ensureInitialSchedule};
