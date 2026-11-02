'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../../config/db');
const {initializeImmunization} = require('../../services/immunization/initialize');
(async () => {
  try {
    await connectDB();
    const {createdMedicalRecords} = await initializeImmunization();
    console.log(`Identified baby ledger summaries created: ${createdMedicalRecords}`);
    // MongoDB has service-account authorization, not per-end-user row policies.
    // These validators add document-shape protection to the new collections.
    for (const [name,required,properties] of [
      ['babies',['motherMasterResidentId','dateOfBirth','scheduleVersion','createdBy','requestKey'],{motherMasterResidentId:{bsonType:'string'},dateOfBirth:{bsonType:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},createdBy:{bsonType:'objectId'}}],
      ['immunizationdoses',['babyId','doseKey','scheduleVersion','state','recordedBy','history'],{babyId:{bsonType:'objectId'},recordedBy:{bsonType:'objectId'},state:{enum:['administered','deferred','void']},history:{bsonType:'array',minItems:1}}],
    ]) {
      await mongoose.connection.db.command({collMod:name,validator:{$jsonSchema:{bsonType:'object',required,properties}},validationLevel:'strict',validationAction:'error'});
    }
    console.log('Immunization indexes, pending schedule and new-collection validators initialized. Legacy records unchanged.');
  } catch (error) {console.error('Immunization migration failed:',error.name);process.exitCode=1;}
  finally {await mongoose.disconnect();}
})();
