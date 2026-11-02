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
    const migrate = () => run(process.execPath,[path.resolve(__dirname,'../../scripts/migrations/immunization.js')],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,MONGO_URI:repl.getUri()}});
    await migrate();
    await migrate();
    assert.equal(JSON.stringify(await legacy.findOne({_id:id})),before,'migration is repeatable and preserves legacy records exactly');
    assert.equal(await mongoose.connection.collection('vaccineschedules').countDocuments({activationStatus:'pending_verification'}),1);
    assert.equal(await mongoose.connection.collection('babies').countDocuments(),0,'migration does not infer babies from text');
    await assert.rejects(mongoose.connection.collection('immunizationdoses').insertOne({state:'administered'}),error=>error.code===121,'database validator rejects incomplete direct writes');
    const indexes = await mongoose.connection.collection('immunizationdoses').indexes();
    assert.ok(indexes.some(index=>index.unique && index.key.babyId === 1 && index.key.doseKey === 1));
    console.log('Immunization additive migration, validators and legacy preservation passed');
  } finally {await mongoose.disconnect();await repl.stop();}
})().catch(error=>{console.error(error);process.exitCode=1;});
