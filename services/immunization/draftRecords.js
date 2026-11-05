'use strict';
const Dose = require('../../models/ImmunizationDose');
const {inBabyTransaction, audit} = require('./clinicalRecords');
const {draftAdministrationFields} = require('./validation');
const {assertRevision} = require('./doseRevision');
const {conflict} = require('../../utils/AppError');

const saveDraft = (user, body) => inBabyTransaction(user, body, async ({baby, doseKey, current, session}) => {
  if (current?.state === 'administered') throw conflict('This dose is already administered. Use a correction with a reason.');
  const values = draftAdministrationFields(baby, body);
  // Retrying the same complete draft snapshot is safe, including after a lost response.
  // A draft saved before a field existed has no value for it, which matches a blank.
  if (current?.workflowStatus === 'draft' && Object.entries(values).every(([key,value]) => (current[key] ?? (typeof value === 'string' ? '' : value)) === value)) return;
  assertRevision(current, body.expectedRevision);
  if (!current) {
    await Dose.create([{
      ...values, babyId:baby._id, doseKey, scheduleVersion:baby.scheduleVersion,
      state:'pending', workflowStatus:'draft', recordedBy:user.userId,
      createdBy:user.userId, updatedBy:user.userId,
      history:[audit(user,'draft_saved','Initial draft',null)],
    }], {session});
    return;
  }
  current.history.push(audit(user,'draft_saved','Draft updated',current));
  current.set({...values, workflowStatus:'draft', recordedBy:user.userId, updatedBy:user.userId, revision:current.revision+1});
  await current.save({session});
}, {clinicalChange:false});
module.exports = {saveDraft};
