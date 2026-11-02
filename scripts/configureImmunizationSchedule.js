'use strict';
// Explicit deployment operation. It never runs during application bootstrap.
require('dotenv').config();
const fs = require('node:fs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Schedule = require('../models/VaccineSchedule');
const {requireDate,todayManila} = require('../services/immunization/calendar');
const {initializeImmunization} = require('../services/immunization/initialize');
const validateDefinition = (definition) => {
  if (!definition.version || !definition.source?.startsWith('https://') || !definition.verifiedBy || !definition.verifiedOn) throw new Error('Source URL, version, verifiedBy and verifiedOn required');
  requireDate(definition.effectiveOn); requireDate(definition.verifiedOn);
  if (definition.verifiedOn > todayManila() || definition.effectiveOn > todayManila()) throw new Error('Cannot activate a future verification or effective date');
  if (!Number.isInteger(definition.dueWindowDays) || definition.dueWindowDays < 0) throw new Error('Approved dueWindowDays required');
  if (!Array.isArray(definition.reminderDays) || definition.reminderDays.some(day => !Number.isInteger(day) || day < 0 || day > 365)) throw new Error('Reminder days must be whole days between 0 and 365');
  const slots = new Map(definition.slots.map(slot => [slot.key,slot]));
  if (slots.size !== definition.slots.length) throw new Error('Duplicate age slot');
  for (const slot of slots.values()) {
    const values = [slot.days,slot.months].filter(value => value !== undefined);
    if (values.length !== 1 || !Number.isInteger(values[0]) || values[0] < 0) throw new Error('Each age slot needs exactly one nonnegative day/month offset');
  }
  const keys = new Set();
  for (const vaccine of definition.vaccines) for (const dose of vaccine.doses) {
    if (!slots.has(dose.slot) || keys.has(dose.key)) throw new Error('Missing slot or duplicate dose key');
    keys.add(dose.key);
  }
  if (!keys.size) throw new Error('At least one dose is required');
};
(async () => {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: node scripts/configureImmunizationSchedule.js /path/to/approved-schedule.json');
    const definition = JSON.parse(fs.readFileSync(file,'utf8'));
    validateDefinition(definition);
    await connectDB(); await initializeImmunization();
    const existing = await Schedule.findOne({version:definition.version}).lean();
    // Clinical definitions are immutable by version. Activation/configuration of
    // the pending seed is allowed only while its doses/offsets are unchanged.
    if (existing) {
      const stripIds = value => JSON.parse(JSON.stringify(value, (key,item) => key === '_id' ? undefined : item));
      for (const key of ['vaccines','slots','source','effectiveOn']) {
        if (JSON.stringify(stripIds(existing[key])) !== JSON.stringify(stripIds(definition[key]))) throw new Error('Definition changed: create a new schedule version');
      }
      await Schedule.updateOne({_id:existing._id},{$set:{activationStatus:'active',verifiedBy:definition.verifiedBy,verifiedOn:definition.verifiedOn,verificationNote:definition.verificationNote || '',dueWindowDays:definition.dueWindowDays,reminderDays:definition.reminderDays}});
    } else await Schedule.create({...definition,activationStatus:'active'});
    console.log('Approved schedule version activated. Existing babies retain their assigned version.');
  } catch (error) {console.error('Schedule configuration failed:',error.message);process.exitCode=1;}
  finally {await mongoose.disconnect();}
})();
