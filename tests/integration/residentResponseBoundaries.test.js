'use strict';
// Staff-only values must never leave the server in a resident response. Unique
// marker strings stand in for real content, so one leak anywhere fails the scan.
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const h = require('./helpers/medicalRecordHarness');

const DRAFT = 'MARKER-DRAFT-VALUE';
const DRAFT_OVER_DEFERRAL = 'MARKER-DRAFT-OVER-DEFERRAL';
const CORRECTION = 'MARKER-CORRECTION-REASON';
const VOID = 'MARKER-VOID-REASON';
const STAFF_NOTE = 'MARKER-STAFF-NOTE';
const MARKERS = [DRAFT, DRAFT_OVER_DEFERRAL, CORRECTION, VOID, STAFF_NOTE];
const FORBIDDEN_KEYS = new Set(['previous','recordedBy','createdBy','updatedBy','requestKey','nameHistory','revisions','revision','workflowStatus','verifiedBy','verificationNote','completedVisits','notes']);

const assertClean = (label, payload) => {
  const text = JSON.stringify(payload);
  for (const marker of MARKERS) assert.ok(!text.includes(marker), `${label} leaks ${marker}`);
  const walk = (value, trail) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${trail}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      assert.ok(!FORBIDDEN_KEYS.has(key), `${label} exposes ${trail}.${key}`);
      if (key === 'history' && !trail.endsWith('$')) assert.deepEqual(item, [], `${label} exposes ${trail}.history`);
      walk(item, `${trail}.${key}`);
    }
  };
  // The top-level history key is the list of records, not an audit trail.
  const {history: records = [], ...rest} = payload;
  walk(rest, label);
  walk(records, `${label}.records`);
};

const call = (path, user, body) => h.request(`/immunization${path}`, {method:'POST',headers:user.role === 'resident' ? h.asResident(user) : h.as(user),body});
const ok = (result, label) => assert.ok(result.status < 300, `${label}: ${result.status} ${JSON.stringify(result.body).slice(0,160)}`);

(async () => {
  let failed = false;
  try {
    await h.setupWithFixtures();
    const User = require('../../models/User');
    const Dose = require('../../models/ImmunizationDose');
    const Schedule = require('../../models/VaccineSchedule');
    const MedicalRecord = require('../../models/MedicalRecord');
    const Appointment = require('../../models/Appointment');
    const midwife = await h.createStaff('midwife');
    const mother = await h.createStaff('resident');
    await User.updateOne({_id:mother._id},{$set:{masterResidentId:'TEST-F',verificationMethod:'admin_review',status:'active',verified:true}});
    const created = await call('/babies',midwife,{motherMasterResidentId:'TEST-F',dateOfBirth:'2026-01-01',requestKey:'boundary-baby'});
    ok(created,'baby');
    const context = {motherMasterResidentId:'TEST-F',babyId:created.body.baby._id};
    await Schedule.updateOne({version:created.body.baby.scheduleVersion},{$set:{activationStatus:'active'}});
    const given = {administeredOn:'2026-02-15',administeredBy:'Test clinician',lotNumber:'TEST-LOT'};

    ok(await call('/drafts',midwife,{...context,doseKey:'bcg-1',expectedRevision:null,remarks:DRAFT}),'draft');
    ok(await call('/follow-up',midwife,{...context,doseKey:'hepb-1',followUpOn:'2999-01-01',reason:'Baby had a fever',deferred:true}),'deferral');
    const deferred = await Dose.findOne({babyId:context.babyId,doseKey:'hepb-1'}).lean();
    ok(await call('/drafts',midwife,{...context,doseKey:'hepb-1',expectedRevision:deferred.revision,remarks:DRAFT_OVER_DEFERRAL}),'draft over deferral');
    ok(await call('/administrations',midwife,{...context,doseKey:'penta-1',...given,expectedRevision:null}),'administer');
    const penta = await Dose.findOne({babyId:context.babyId,doseKey:'penta-1'}).lean();
    ok(await call('/corrections',midwife,{...context,doseKey:'penta-1',action:'correct',reason:CORRECTION,expectedRevision:penta.revision,administration:{...given,lotNumber:'TEST-LOT-2'}}),'correct');
    ok(await call('/administrations',midwife,{...context,doseKey:'opv-1',...given,expectedRevision:null}),'administer for void');
    const opv = await Dose.findOne({babyId:context.babyId,doseKey:'opv-1'}).lean();
    ok(await call('/corrections',midwife,{...context,doseKey:'opv-1',action:'void',reason:VOID,expectedRevision:opv.revision}),'void');
    const ledgerBefore = JSON.stringify(await Dose.find({babyId:context.babyId}).sort({doseKey:1}).lean());

    const checklist = await call('/checklist',mother,context);
    assert.equal(checklist.status,200);
    assertClean('checklist',checklist.body);
    const dose = key => checklist.body.doses.find(item => item.key === key);
    assert.equal(dose('bcg-1').record,null,'a draft reads as no record');
    assert.equal(dose('penta-1').record.lotNumber,'TEST-LOT-2','finalized details stay visible, with current values');
    assert.equal(dose('penta-1').record.administeredBy,midwife.fullname,'the clinician is the verified midwife, not the sent name');
    assert.equal(dose('penta-1').record.reason,undefined,'a correction reason stays private');
    assert.equal(dose('hepb-1').record.followUpOn,'2999-01-01','follow-up stays visible under a later draft');
    assert.equal(dose('hepb-1').record.reason,'Baby had a fever','a deferral reason stays visible');
    assert.equal(dose('hepb-1').status,'Deferred');
    assert.equal(dose('opv-1').record,null,'a void sends no clinical values');
    assert.equal(dose('opv-1').status,'Requires review','a void does not turn into Overdue');
    assert.deepEqual(checklist.body.history.map(item => item.doseKey).sort(),['hepb-1','penta-1'],'history holds only finalized entries');

    const babies = await call('/babies/search',mother,{});
    assert.equal(babies.status,200);
    assertClean('babies',babies.body);
    assert.equal(babies.body.babies[0].name,created.body.baby.name);

    const records = await h.myRecords(mother);
    assert.equal(records.status,200);
    const summary = records.body.medicalRecords.find(row => row.immunizationBabyId);
    assert.ok(summary,'the baby summary stays in the resident list');
    assert.equal(summary.workflowStatus,undefined,'no draft label on the summary');
    assert.equal(summary.recordStatus,'in_progress');
    assert.equal((await h.myRecordPage(mother)).body.medicalRecords.find(row => row.immunizationBabyId).workflowStatus,undefined);

    const staffView = await call('/checklist',midwife,context);
    const staffText = JSON.stringify(staffView.body);
    assert.equal(checklist.body.nextProposedDate,staffView.body.nextProposedDate,'resident and midwife agree on the next proposed visit');
    for (const item of staffView.body.doses) assert.equal(dose(item.key).status,item.status,`resident and midwife agree on ${item.key}`);
    for (const marker of [DRAFT,DRAFT_OVER_DEFERRAL,CORRECTION,VOID]) assert.ok(staffText.includes(marker),`midwife keeps ${marker}`);
    assert.ok(staffView.body.doses.find(item => item.key === 'penta-1').record.history.length >= 2,'midwife keeps the audit trail');
    assert.equal(JSON.stringify(await Dose.find({babyId:context.babyId}).sort({doseKey:1}).lean()),ledgerBefore,'resident reads never change the ledger');

    // The record date follows finalized care, not draft edits.
    const dated = await call('/babies',midwife,{motherMasterResidentId:'TEST-F',dateOfBirth:'2026-01-01',requestKey:'boundary-dated'});
    const datedContext = {motherMasterResidentId:'TEST-F',babyId:dated.body.baby._id};
    ok(await call('/administrations',midwife,{...datedContext,doseKey:'bcg-1',...given,expectedRevision:null}),'dated dose');
    const before = (await MedicalRecord.findOne({immunizationBabyId:datedContext.babyId}).lean()).completedAt.toISOString();
    assert.equal(before.slice(0,10),'2026-02-15');
    ok(await call('/drafts',midwife,{...datedContext,doseKey:'hepb-1',expectedRevision:null,remarks:'Test later draft'}),'later draft');
    assert.equal((await MedicalRecord.findOne({immunizationBabyId:datedContext.babyId}).lean()).completedAt.toISOString(),before,'a draft does not move the record date');

    // A staff-only note on a completed visit stays out of the appointment list.
    const recordId = (await MedicalRecord.collection.insertOne({resident:mother._id,serviceType:'bp_checking',completedAt:new Date(),assessment:'Reading within range',notes:STAFF_NOTE,revisions:[{note:STAFF_NOTE}]})).insertedId;
    await Appointment.collection.insertOne({resident:mother._id,consultationType:'bp_checking',status:'completed',slotStart:new Date(),medicalRecord:recordId,createdAt:new Date(),updatedAt:new Date()});
    const appointments = await h.request('/appointments/me',{method:'GET',headers:h.asResident(mother)});
    assert.equal(appointments.status,200);
    const visit = appointments.body.appointments.find(row => row.medicalRecord);
    assert.equal(visit.medicalRecord.assessment,'Reading within range','the resident keeps the clinical summary');
    assert.equal(visit.medicalRecord.notes,undefined,'staff-only notes stay private');
    assert.equal(visit.medicalRecord.revisions,undefined,'revisions stay private');

    // Registration answers bad input with a refusal, never a crash.
    const refuses = async (path, body, label) => {
      const result = await h.request(path,{method:'POST',body});
      assert.ok(result.status >= 400 && result.status < 500,`${path} with ${label} answered ${result.status}: ${result.body?.message}`);
    };
    // Each of these throttles quickly, and a 429 would hide a crash, so they run first.
    await refuses('/send-otp',{email:{a:1}},'a non-text email');
    await refuses('/send-otp',undefined,'no body');
    await refuses('/verify-otp',{email:{a:1},otp:'123456'},'a non-text email');
    await refuses('/verify-otp',undefined,'no body');
    const complete = {fullname:'Test Person',email:'test.person@maslogcare.test',password:'TestPass1!',gender:'female',dateOfBirth:'1990-01-01',address:'Test address line'};
    const structured = {firstName:'Test',surname:'Person',email:'test.person@maslogcare.test',password:'TestPass1!',sex:'female',dateOfBirth:'1990-01-01',address:{barangay:'Maslog'}};
    for (const key of Object.keys(complete)) await refuses('/register',{...complete,[key]:{a:1}},`a non-text ${key}`);
    for (const key of ['firstName','surname','email','password','sex','dateOfBirth','phone','idType','idNumber','emailVerificationToken']) await refuses('/register',{...structured,[key]:{a:1}},`a structured non-text ${key}`);
    console.log('Resident response boundaries passed');
  } catch (error) {
    failed = true;
    console.error(error.message);
  } finally {
    await h.teardown();
    await mongoose.disconnect().catch(() => {});
    process.exitCode = failed ? 1 : 0;
  }
})();
