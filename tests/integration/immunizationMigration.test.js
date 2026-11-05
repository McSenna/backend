'use strict';
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {MongoMemoryReplSet} = require('mongodb-memory-server');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const path = require('node:path');
const run = promisify(execFile);
(async () => {
  const repl = await MongoMemoryReplSet.create({replSet:{count:1}});
  try {
    await mongoose.connect(repl.getUri());
    const legacy = mongoose.connection.collection('medicalrecords');
    const id = (await legacy.insertOne({serviceType:'immunization',serviceDetails:{vaccineName:'Ambiguous legacy test entry'},completedAt:new Date('2024-01-01')})).insertedId;
    const before = JSON.stringify(await legacy.findOne({_id:id}));
    // An environment migrated before the draft fix keeps the old validator until
    // the migration runs again, so start from that installed state.
    const doses = mongoose.connection.collection('immunizationdoses');
    const doseShape = (state) => ({babyId:new mongoose.Types.ObjectId(),doseKey:`shape-${state}`,scheduleVersion:'test-version',recordedBy:new mongoose.Types.ObjectId(),history:[{action:'test'}],state});
    await mongoose.connection.db.createCollection('immunizationdoses',{validator:{$jsonSchema:{bsonType:'object',required:['babyId','doseKey','scheduleVersion','state','recordedBy','history'],properties:{state:{enum:['administered','deferred','void']}}}}});
    await assert.rejects(doses.insertOne(doseShape('pending')),error=>error.code===121,'the previously installed validator rejects drafts');
    const migrate =() => run(process.execPath,[path.resolve(__dirname,'../../scripts/migrations/immunization.js')],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,MONGO_URI:repl.getUri()}});
    await migrate();
    await migrate();
    assert.equal(JSON.stringify(await legacy.findOne({_id:id})),before,'migration is repeatable and preserves legacy records exactly');
    assert.equal(await mongoose.connection.collection('vaccineschedules').countDocuments({activationStatus:'pending_verification'}),1);
    assert.equal(await mongoose.connection.collection('babies').countDocuments(),0,'migration does not infer babies from text');
    await assert.rejects(mongoose.connection.collection('immunizationdoses').insertOne({state:'administered'}),error=>error.code===121,'database validator rejects incomplete direct writes');
    await assert.rejects(doses.insertOne(doseShape('unknown')),error=>error.code===121,'database validator still rejects unknown dose states');
    const midwifeId = new mongoose.Types.ObjectId();
    const schedule = await mongoose.connection.collection('vaccineschedules').findOne({activationStatus:'pending_verification'});
    await mongoose.connection.collection('master_residents').insertOne({masterResidentId:'TEST-MIGRATION',firstName:'Test',lastName:'Mother',dateOfBirth:new Date('1990-01-01'),sex:'female',address:'Test address',isActive:true,deletedAt:null});
    const babyId = (await mongoose.connection.collection('babies').insertOne({motherMasterResidentId:'TEST-MIGRATION',name:'Test baby',dateOfBirth:'2026-01-01',scheduleVersion:schedule.version,createdBy:midwifeId,requestKey:'migration-draft-baby',revision:0})).insertedId;
    const {saveDraft} = require('../../services/immunization/draftRecords');
    await saveDraft({role:'midwife',userId:midwifeId},{motherMasterResidentId:'TEST-MIGRATION',babyId:String(babyId),doseKey:'bcg-1',expectedRevision:null,remarks:'Test draft after migration'});
    const draft = await doses.findOne({babyId,doseKey:'bcg-1'});
    assert.equal(draft.state,'pending','a draft saves through the real service after migration');
    assert.equal(draft.workflowStatus,'draft');
    const indexes = await mongoose.connection.collection('immunizationdoses').indexes();
    assert.ok(indexes.some(index=>index.unique && index.key.babyId === 1 && index.key.doseKey === 1));
    console.log('Immunization additive migration, validators and legacy preservation passed');
  } finally {await mongoose.disconnect();await repl.stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
