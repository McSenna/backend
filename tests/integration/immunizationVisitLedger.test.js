'use strict';
// A completed visit resolves to its baby only through the stored link, only for
// authorized viewers. Dose reactions travel the whole path from form to resident.
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const h = require('./helpers/medicalRecordHarness');

const call = (path,user,body) => h.request(`/immunization${path}`,{method:'POST',headers:user.role === 'resident' ? h.asResident(user) : h.as(user),body});
const ok = (result,label) => assert.ok(result.status < 300,`${label}: ${result.status} ${JSON.stringify(result.body).slice(0,200)}`);
const DRAFT_REACTION = 'MARKER-DRAFT-REACTION';
const VOID_REACTION = 'MARKER-VOID-REACTION';

(async () => {
  let failed = false;
  try {
    await h.setupWithFixtures();
    const User = require('../../models/User');
    const Baby = require('../../models/Baby');
    const Dose = require('../../models/ImmunizationDose');
    const Schedule = require('../../models/VaccineSchedule');
    const MedicalRecord = require('../../models/MedicalRecord');
    const Appointment = require('../../models/Appointment');
    const {todayManila} = require('../../services/immunization/calendar');
    const verify = (user,id) => User.updateOne({_id:user._id},{$set:{masterResidentId:id,verificationMethod:'admin_review',status:'active',verified:true}});
    const midwife = await h.createStaff('midwife');
    const admin = await h.createStaff('admin');
    const mother = await h.createStaff('resident');
    const otherMother = await h.createStaff('resident');
    await verify(mother,'TEST-F');
    await verify(otherMother,'TEST-A');
    const babyOf = async (id,key) => (await call('/babies',midwife,{motherMasterResidentId:id,dateOfBirth:'2026-01-01',requestKey:key})).body.baby;
    const baby = await babyOf('TEST-F','visit-baby');
    const twin = await babyOf('TEST-F','visit-twin');
    await Schedule.updateOne({version:baby.scheduleVersion},{$set:{activationStatus:'active'}});
    const context = {motherMasterResidentId:'TEST-F',babyId:baby._id};
    const today = todayManila();

    // Reactions: draft, final save, correction and audit.
    ok(await call('/drafts',midwife,{...context,doseKey:'bcg-1',expectedRevision:null,immediateReaction:DRAFT_REACTION}),'draft');
    const hidden = await call('/checklist',mother,context);
    assert.ok(!JSON.stringify(hidden.body).includes(DRAFT_REACTION),'a draft reaction stays with the midwife');
    const draft = await Dose.findOne({babyId:baby._id,doseKey:'bcg-1'}).lean();
    assert.equal(draft.immediateReaction,DRAFT_REACTION,'a draft saves the reaction');
    await Dose.collection.updateOne({_id:draft._id},{$unset:{aefi:1}});
    ok(await call('/drafts',midwife,{...context,doseKey:'bcg-1',expectedRevision:draft.revision - 1,immediateReaction:DRAFT_REACTION}),'identical retry of a draft that predates a field');
    assert.equal((await Dose.findById(draft._id).lean()).revision,draft.revision,'that retry changes nothing');
    ok(await call('/administrations',midwife,{...context,doseKey:'bcg-1',administeredOn:today,immediateReaction:'Mild redness',aefi:'Fever reported',expectedRevision:draft.revision}),'administer');
    const saved = await Dose.findOne({babyId:baby._id,doseKey:'bcg-1'}).lean();
    assert.equal(saved.immediateReaction,'Mild redness');
    assert.equal(saved.aefi,'Fever reported');
    ok(await call('/corrections',midwife,{...context,doseKey:'bcg-1',action:'correct',reason:'Wording',expectedRevision:saved.revision,administration:{administeredOn:today,immediateReaction:'Mild redness, resolved',aefi:''}}),'correct');
    const corrected = await Dose.findOne({babyId:baby._id,doseKey:'bcg-1'}).lean();
    assert.equal(corrected.immediateReaction,'Mild redness, resolved');
    assert.equal(corrected.aefi,'','a correction can clear a value');
    assert.equal(corrected.history.at(-1).previous.aefi,'Fever reported','the audit keeps the replaced value');
    assert.equal((await call('/administrations',midwife,{...context,doseKey:'hepb-1',administeredOn:today,aefi:'x'.repeat(2001)})).status,400,'a reaction has a length limit');
    assert.equal((await call('/administrations',midwife,{...context,doseKey:'hepb-1',administeredOn:today,immediateReaction:{a:1}})).status,400,'a reaction must be text');

    // A blank stays blank, and old rows have nothing: neither becomes "no reaction".
    ok(await call('/administrations',midwife,{...context,doseKey:'hepb-1',administeredOn:today}),'administer without a reaction');
    const seen = (await call('/checklist',mother,context)).body;
    const seenDose = key => seen.doses.find(row => row.key === key).record;
    assert.equal(seenDose('bcg-1').immediateReaction,'Mild redness, resolved','the mother reads a finalized reaction');
    assert.equal(seenDose('bcg-1').history.length,0,'but not its audit trail');
    assert.ok(!JSON.stringify(seen).includes('Fever reported'),'nor a replaced value');
    assert.equal(seenDose('hepb-1').aefi,'');

    // A void keeps stored values, which must not reach the mother.
    ok(await call('/administrations',midwife,{...context,doseKey:'opv-1',administeredOn:today,immediateReaction:VOID_REACTION}),'administer for void');
    const toVoid = await Dose.findOne({babyId:baby._id,doseKey:'opv-1'}).lean();
    ok(await call('/corrections',midwife,{...context,doseKey:'opv-1',action:'void',reason:'Wrong baby',expectedRevision:toVoid.revision}),'void');

    // A visit with no stored link: the lookup must not guess.
    const older = await MedicalRecord.create({resident:mother._id,appointment:new mongoose.Types.ObjectId(),provider:midwife._id,providerRole:'midwife',serviceType:'immunization',assessment:'Older visit',serviceDetails:{ledgerSummary:true},completedAt:new Date()});
    assert.deepEqual((await call('/visits/doses',mother,{recordId:String(older._id)})).body,{linked:false},'an older visit stays unlinked');

    // A completed visit.
    const appointment = await Appointment.create({resident:mother._id,consultationType:'immunization',status:'confirmed',slotStart:new Date(`${today}T00:00:00Z`),ageTier:0,prioritySortKey:0});
    const done = await call('/visits/complete',midwife,{...context,appointmentId:String(appointment._id)});
    assert.equal(done.status,200,JSON.stringify(done.body));
    const recordId = String(done.body.medicalRecord._id);
    const stored = await MedicalRecord.findById(recordId).lean();
    assert.deepEqual(stored.serviceDetails,{ledgerSummary:true},'no clinical data is copied onto the visit');
    assert.equal(stored.immunizationBabyId,undefined,'the one-per-baby summary link stays off visit records');

    const byMother = await call('/visits/doses',mother,{recordId});
    assert.equal(byMother.status,200,JSON.stringify(byMother.body));
    assert.equal(byMother.body.linked,true);
    assert.equal(byMother.body.checklist.baby._id,baby._id,'it resolves to the visit baby, not the twin');
    assert.equal(byMother.body.visitDay,today);
    assert.deepEqual([...byMother.body.visitDoseKeys].sort(),['bcg-1','hepb-1'],'the mother sees that visit, without the void');
    const text = JSON.stringify(byMother.body);
    assert.ok(!text.includes(VOID_REACTION) && !text.includes('completedVisits') && !text.includes('"recordedBy"'),'resident limits still apply');

    const byMidwife = await call('/visits/doses',midwife,{recordId});
    assert.equal(byMidwife.status,200);
    assert.deepEqual([...byMidwife.body.visitDoseKeys].sort(),['bcg-1','hepb-1','opv-1'],'the midwife also sees the void');

    // The ledger stays the source: a corrected date leaves the visit.
    const hepb = await Dose.findOne({babyId:baby._id,doseKey:'hepb-1'}).lean();
    ok(await call('/corrections',midwife,{...context,doseKey:'hepb-1',action:'correct',reason:'Date',expectedRevision:hepb.revision,administration:{administeredOn:'2026-02-01'}}),'correct the date');
    assert.deepEqual((await call('/visits/doses',mother,{recordId})).body.visitDoseKeys,['bcg-1'],'a moved dose leaves the visit');

    // Who may not read it.
    assert.equal((await call('/visits/doses',otherMother,{recordId})).status,403,"another resident cannot read this visit");
    assert.equal((await call('/visits/doses',admin,{recordId})).status,403,'an admin gets the same refusal as the checklist');
    assert.equal((await h.request('/immunization/visits/doses',{method:'POST',body:{recordId}})).status,401,'signing in is required');
    assert.equal((await call('/visits/doses',mother,{recordId:'not-an-id'})).status,400);
    assert.equal((await call('/visits/doses',mother,{recordId:String(new mongoose.Types.ObjectId())})).status,404);

    // The record is the mother's, but the stored link points at another mother's baby.
    const foreign = await babyOf('TEST-A','foreign-baby');
    assert.ok(foreign?._id,'the second mother has a baby');
    const crossedVisit = await Appointment.create({resident:mother._id,consultationType:'immunization',status:'completed',slotStart:new Date(`${today}T00:00:00Z`),ageTier:0,prioritySortKey:0});
    const crossed = await MedicalRecord.create({resident:mother._id,appointment:crossedVisit._id,provider:midwife._id,providerRole:'midwife',serviceType:'immunization',assessment:'Crossed',serviceDetails:{ledgerSummary:true},completedAt:new Date()});
    await Baby.updateOne({_id:foreign._id},{$push:{completedVisits:{appointmentId:crossedVisit._id,recordId:crossed._id}}});
    const refused = await call('/visits/doses',mother,{recordId:String(crossed._id)});
    assert.equal(refused.status,403,"another mother's baby is refused");
    assert.ok(!JSON.stringify(refused.body).includes(foreign.name),'and the refusal names no baby');
    assert.equal((await call('/visits/doses',otherMother,{recordId:String(crossed._id)})).status,403,"the baby's mother does not own this visit record");

    // A link claimed by two babies is ambiguous, so it stays unlinked.
    await Baby.updateOne({_id:twin._id},{$push:{completedVisits:{appointmentId:appointment._id,recordId}}});
    assert.deepEqual((await call('/visits/doses',mother,{recordId})).body,{linked:false},'two babies on one visit stays unlinked');
    await Baby.updateOne({_id:twin._id},{$pull:{completedVisits:{recordId}}});

    // Unlinking the account removes access at once.
    await User.updateOne({_id:mother._id},{$unset:{masterResidentId:1}});
    assert.equal((await call('/visits/doses',mother,{recordId})).status,403,'unlink applies immediately');

    // One visit does not complete the program.
    const program = await MedicalRecord.findOne({immunizationBabyId:baby._id}).lean();
    assert.equal(program.recordStatus,'in_progress','completing a visit leaves the program in progress');
    assert.equal((await Appointment.findById(appointment._id).lean()).status,'completed');
    console.log('Immunization visit ledger and reactions passed');
  } catch (error) {
    failed = true;
    console.error(error.stack || error.message);
  } finally {
    await h.teardown();
    await mongoose.disconnect().catch(() => {});
    process.exitCode = failed ? 1 : 0;
  }
})();
