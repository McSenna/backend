'use strict';
const express = require('express');
const auth = require('../middleware/authMiddleware');
const roleCheck = require('../middleware/roleMiddleware');
const asyncHandler = require('../utils/asyncHandler');
const {badRequest} = require('../utils/AppError');
const User = require('../models/User');
const registry = require('../services/immunization/registry');
const {getChecklist} = require('../services/immunization/checklistService');
const clinical = require('../services/immunization/clinicalRecords');
const router = express.Router();
const write = [auth,roleCheck(['midwife'])];
const read = [auth,roleCheck(['midwife','resident'])];
const post = (path,guards,handler) => router.post(`/immunization${path}`,...guards,asyncHandler(handler));
post('/mothers/search',write,async (req,res) => res.json({mothers:await registry.searchMothers(req.user,req.body)}));
post('/babies/search',read,async (req,res) => res.json({babies:await registry.listBabies(req.user,req.body)}));
post('/babies',write,async (req,res) => {
  const result = await registry.createBaby(req.user,req.body);
  res.status(result.created ? 201 : 200).json({baby:result.baby});
});
post('/babies/rename',write,async (req,res) => res.json({baby:await registry.renameBaby(req.user,req.body)}));
post('/checklist',read,async (req,res) => res.json(await getChecklist(req.user,req.body)));
post('/drafts',write,async (req,res) => {
  await require('../services/immunization/draftRecords').saveDraft(req.user,req.body);
  res.json({success:true});
});
post('/administrations',write,async (req,res) => {
  await clinical.saveAdministration(req.user,req.body);
  res.status(201).json({success:true});
});
post('/corrections',write,async (req,res) => {
  await clinical.correctAdministration(req.user,req.body);
  res.json({success:true});
});
post('/follow-up',write,async (req,res) => {
  await clinical.saveFollowUp(req.user,req.body);
  res.json({success:true});
});
post('/visits/doses',read,async (req,res) => res.json(await require('../services/immunization/visitLedger').getVisitLedger(req.user,req.body)));
post('/visits/complete',write,async (req,res) => {
  const result = await require('../services/immunization/visitCompletion').completeImmunizationVisit(req.user,req.body);
  res.json({success:true,...result});
});
post('/preferences',[auth,roleCheck(['resident'])],async (req,res) => {
  if (typeof req.body.enabled !== 'boolean') throw badRequest('Specify whether reminders are enabled.');
  await User.updateOne({_id:req.user.userId},{$set:{immunizationRemindersEnabled:req.body.enabled},$inc:{immunizationReminderFence:1}});
  if (!req.body.enabled) await require('../services/immunization/reminderWorker').cancelPendingForRecipient(req.user.userId);
  res.json({success:true});
});
module.exports = router;
