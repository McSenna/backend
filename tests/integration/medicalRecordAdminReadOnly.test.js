'use strict';
const assert = require('node:assert/strict');
const h = require('./helpers/medicalRecordHarness');
const Record = require('../../models/MedicalRecord');
const Appointment = require('../../models/Appointment');
const User = require('../../models/User');
const {createEncodedRecord,updateEncodedRecord} = require('../../services/medicalRecord/masterlistRecordService');
const {deleteMedicalRecord} = require('../../services/medicalRecord/deletionService');
const forbidden = error => error.statusCode === 403;
(async()=>{
 let failed=false;
 try {
  await h.setupWithFixtures();
  const admin=await h.createStaff('admin'),bhw=await h.createStaff('bhw'),resident=await h.createStaff('resident');
  const saved=await h.encode(bhw,h.bpRecord({requestKey:'clinical-owner'}));
  assert.equal(saved.status,201,JSON.stringify(saved.body));
  const encoded=await Record.findById(saved.body.detail._id).lean();
  const legacy=await Record.create({source:'manual_entry',masterResidentId:'TEST-F',serviceType:'bp_checking',completedAt:new Date('2024-04-01'),providerName:'Historical encoder',providerRole:'admin',createdBy:admin._id,createdByRole:'admin',serviceDetails:{systolic:120,diastolic:80}});
  const appointment=await Appointment.create({resident:resident._id,consultationType:'general_checkup',status:'confirmed',slotStart:new Date('2024-04-01'),ageTier:4,prioritySortKey:4});
  const appointmentRecord=await Record.create({resident:resident._id,appointment:appointment._id,provider:admin._id,providerRole:'admin',serviceType:'general_checkup',completedAt:new Date('2024-04-01'),assessment:'Fictional legacy record'});
  const before=JSON.stringify(await Record.find().sort({_id:1}).lean());
  const visitBefore=JSON.stringify(await Appointment.findById(appointment._id).lean());
  const newRecord=h.bpRecord({requestKey:'admin-create',visitDate:'2024-04-02'});
  assert.equal((await h.encode(admin,newRecord)).status,403,'admin cannot add a record');
  assert.equal((await h.encode(admin,{})).status,403,'write authorization precedes validation');
  for(const row of [encoded,legacy,appointmentRecord]) {
    const id=String(row._id),headers=h.as(admin);
    const detail=await h.request(`/medical-record-masterlist/${id}`,{headers});
    assert.equal(detail.status,200,'admin can view every record source');
    assert.equal(detail.body.detail.editable,false,'admin details never advertise edit access');
    assert.equal((await h.request(`/medical-record-masterlist/${id}`,{method:'PATCH',headers,body:{...newRecord,reason:'Not permitted'}})).status,403,'admin cannot edit any source, including own legacy records');
    assert.equal((await h.request('/medical-record-masterlist/delete',{method:'POST',headers,body:{recordId:id,reason:'Not permitted',expectedUpdatedAt:new Date(row.updatedAt).toISOString()}})).status,403,'admin cannot delete any source');
  }
  assert.equal((await h.search(admin)).body.pagination.total,3,'admin can list records');
  assert.equal((await h.request('/medical-record-masterlist/summary',{headers:h.as(admin)})).body.summary.total,3,'admin can view summary');
  assert.equal((await h.request(`/medical-records/${appointmentRecord._id}`,{headers:h.as(admin)})).status,200,'alternate detail remains readable');
  assert.equal((await h.request(`/appointments/${appointment._id}/complete`,{method:'POST',headers:h.as(admin),body:{assessment:'Not permitted'}})).status,403,'completion cannot bypass record creation restriction');
  assert.equal((await h.request(`/appointments/${appointment._id}/processing`,{method:'PATCH',headers:h.as(admin),body:{}})).status,403,'admin cannot begin clinical processing');
  const actor={userId:String(admin._id),role:'admin'};
  await assert.rejects(createEncodedRecord(actor,newRecord),forbidden,'create service also rejects admin');
  await assert.rejects(updateEncodedRecord(actor,String(encoded._id),newRecord),forbidden,'update service also rejects admin');
  await assert.rejects(deleteMedicalRecord(actor,{recordId:String(encoded._id),reason:'Not permitted',expectedUpdatedAt:encoded.updatedAt.toISOString()}),forbidden,'delete service also rejects admin');
  const oldHeaders=h.as(bhw);
  await User.updateOne({_id:bhw._id},{$set:{role:'admin'}});
  assert.equal((await h.request('/medical-record-masterlist',{method:'POST',headers:oldHeaders,body:newRecord})).status,403,'current database role overrides an older clinical token');
  assert.equal(JSON.stringify(await Record.find().sort({_id:1}).lean()),before,'denied operations do not change clinical data');
  assert.equal(JSON.stringify(await Appointment.findById(appointment._id).lean()),visitBefore,'denied completion does not alter appointment');
  console.log('Admin medical record read-only access: HTTP and service write denial, read access, legacy ownership, unchanged data and refreshed role passed');
 } catch(error) {failed=true;console.error(error);}
 await h.finish(failed);
})();
