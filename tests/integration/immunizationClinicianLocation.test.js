'use strict';
// Clinician and location come from the server's verified session, never the request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const h = require('./helpers/medicalRecordHarness');
const {IMMUNIZATION_LOCATION} = require('../../config/healthCenter');

const call = (route,user,body) => h.request(`/immunization${route}`,{method:'POST',headers:user.role === 'resident' ? h.asResident(user) : h.as(user),body});
const ok = (result,label) => assert.ok(result.status < 300,`${label}: ${result.status} ${JSON.stringify(result.body).slice(0,200)}`);

(async () => {
  let failed = false;
  try {
    await h.setupWithFixtures();
    const User = require('../../models/User');
    const Dose = require('../../models/ImmunizationDose');
    const {todayManila} = require('../../services/immunization/calendar');
    const today = todayManila();
    const midwifeA = await h.createStaff('midwife');
    const midwifeB = await h.createStaff('midwife');
    const admin = await h.createStaff('admin');
    const doctor = await h.createStaff('doctor');
    const resident = await h.createStaff('resident');
    await User.updateOne({_id:midwifeA._id},{$set:{fullname:'Fixture Maria Santos'}});
    await User.updateOne({_id:midwifeB._id},{$set:{fullname:'Fixture Ana Reyes'}});
    const baby = (await call('/babies',midwifeA,{motherMasterResidentId:'TEST-F',dateOfBirth:'2026-01-01',requestKey:'clinician-baby'})).body.baby;
    const context = {motherMasterResidentId:'TEST-F',babyId:baby._id};
    const stored = (doseKey) => Dose.findOne({babyId:baby._id,doseKey}).lean();

    assert.equal(IMMUNIZATION_LOCATION,'Maslog Healthcare Center');
    const shown = fs.readFileSync(path.resolve(__dirname,'../../../maslogCare/src/config/healthCenter.ts'),'utf8');
    assert.ok(shown.includes(`"${IMMUNIZATION_LOCATION}"`),'the app displays the same location the server saves');

    // Each midwife is recorded as herself.
    ok(await call('/administrations',midwifeA,{...context,doseKey:'bcg-1',administeredOn:today,expectedRevision:null}),'A administers');
    ok(await call('/administrations',midwifeB,{...context,doseKey:'hepb-1',administeredOn:today,expectedRevision:null}),'B administers');
    const byA = await stored('bcg-1');
    const byB = await stored('hepb-1');
    assert.equal(byA.administeredBy,'Fixture Maria Santos');
    assert.equal(byA.facility,IMMUNIZATION_LOCATION);
    assert.equal(String(byA.recordedBy),String(midwifeA._id),'the verified account ID is kept with the record');
    assert.equal(byA.route,'Intradermal','with no route field on the form, the schedule supplies it');
    assert.equal(byA.lotNumber,'','and no lot is invented');
    assert.equal(byB.administeredBy,'Fixture Ana Reyes');
    assert.equal(byB.facility,IMMUNIZATION_LOCATION);

    // A manipulated request changes nothing.
    ok(await call('/administrations',midwifeA,{...context,doseKey:'opv-1',administeredOn:today,administeredBy:'Fixture Impersonated',facility:'Fixture Other Clinic',recordedBy:String(midwifeB._id),expectedRevision:null}),'forged request');
    const forged = await stored('opv-1');
    assert.equal(forged.administeredBy,'Fixture Maria Santos','a sent clinician is ignored');
    assert.equal(forged.facility,IMMUNIZATION_LOCATION,'a sent location is ignored');
    assert.equal(String(forged.recordedBy),String(midwifeA._id),'a sent account ID is ignored');

    // A draft claims neither, and the one who finalizes it is recorded.
    ok(await call('/drafts',midwifeA,{...context,doseKey:'penta-1',administeredBy:'Fixture Impersonated',facility:'Fixture Other Clinic',lotNumber:'TEST-LOT',expectedRevision:null}),'draft');
    const draft = await stored('penta-1');
    assert.equal(draft.administeredBy,'');
    assert.equal(draft.facility,'');
    ok(await call('/administrations',midwifeB,{...context,doseKey:'penta-1',administeredOn:today,lotNumber:'TEST-LOT',expectedRevision:draft.revision}),'finalize');
    const finalized = await stored('penta-1');
    assert.equal(finalized.administeredBy,'Fixture Ana Reyes');
    assert.equal(finalized.facility,IMMUNIZATION_LOCATION);

    // A correction by another midwife keeps who gave the dose and records who changed it.
    ok(await call('/corrections',midwifeB,{...context,doseKey:'bcg-1',action:'correct',reason:'Fix lot',expectedRevision:byA.revision,administration:{administeredOn:today,lotNumber:'TEST-FIXED',administeredBy:'Fixture Impersonated',facility:'Fixture Other Clinic'}}),'correct');
    const corrected = await stored('bcg-1');
    assert.equal(corrected.lotNumber,'TEST-FIXED');
    assert.equal(corrected.administeredBy,'Fixture Maria Santos','a correction does not change who gave the dose');
    assert.equal(corrected.facility,IMMUNIZATION_LOCATION);
    assert.equal(String(corrected.updatedBy),String(midwifeB._id),'the editor is recorded');
    assert.equal(String(corrected.recordedBy),String(midwifeB._id));
    const event = corrected.history.at(-1);
    assert.equal(event.action,'correct');
    assert.equal(String(event.actor),String(midwifeB._id),'the audit names the editor');
    assert.ok(event.at instanceof Date,'the audit has a time');
    assert.equal(event.previous.administeredBy,'Fixture Maria Santos','the audit keeps the earlier values');
    assert.equal(event.previous.lotNumber,'');

    // A record saved before this rule keeps its own location.
    await Dose.updateOne({_id:byB._id},{$set:{facility:'Fixture Earlier Clinic',administeredBy:'Fixture Earlier Nurse'}});
    ok(await call('/corrections',midwifeA,{...context,doseKey:'hepb-1',action:'correct',reason:'Fix site',expectedRevision:byB.revision,administration:{administeredOn:today,site:'Left thigh'}}),'correct older');
    const older = await stored('hepb-1');
    assert.equal(older.facility,'Fixture Earlier Clinic');
    assert.equal(older.administeredBy,'Fixture Earlier Nurse');

    // A dose copied from an earlier record says what that record says.
    assert.equal((await call('/administrations',midwifeA,{...context,doseKey:'ipv-1',administeredOn:today,historical:true,expectedRevision:null})).status,400,'it still needs a clinician');
    ok(await call('/administrations',midwifeA,{...context,doseKey:'ipv-1',administeredOn:today,historical:true,administeredBy:'Fixture Paper Nurse',facility:'Fixture Birth Hospital',expectedRevision:null}),'historical');
    const historical = await stored('ipv-1');
    assert.equal(historical.administeredBy,'Fixture Paper Nurse');
    assert.equal(historical.facility,'Fixture Birth Hospital');
    assert.equal(String(historical.recordedBy),String(midwifeA._id),'but the account that copied it is recorded');
    assert.equal(historical.reviewRequired,true,'and it is flagged for review');

    // Who may not record.
    for (const [user,status,label] of [[admin,403,'admin'],[doctor,403,'doctor'],[resident,403,'resident']]) {
      const before = await Dose.countDocuments({babyId:baby._id});
      assert.equal((await call('/administrations',user,{...context,doseKey:'mmr-1',administeredOn:today,administeredBy:'Fixture Impersonated',expectedRevision:null})).status,status,label);
      assert.equal(await Dose.countDocuments({babyId:baby._id}),before,`${label} wrote nothing`);
    }
    assert.equal((await h.request('/immunization/administrations',{method:'POST',body:{...context,doseKey:'mmr-1',administeredOn:today}})).status,401,'signing in is required');

    // An account with no name cannot be recorded as a clinician.
    await User.collection.updateOne({_id:midwifeB._id},{$set:{fullname:'   '}});
    const nameless = await call('/administrations',midwifeB,{...context,doseKey:'mmr-1',administeredOn:today,expectedRevision:null});
    assert.equal(nameless.status,403,JSON.stringify(nameless.body));
    assert.equal(await stored('mmr-1'),null,'nothing was saved');
    console.log('Immunization clinician and location passed');
  } catch (error) {
    failed = true;
    console.error(error.stack || error.message);
  } finally {
    await h.teardown();
    await mongoose.disconnect().catch(() => {});
    process.exitCode = failed ? 1 : 0;
  }
})();
