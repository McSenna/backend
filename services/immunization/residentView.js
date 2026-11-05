'use strict';

// What a verified linked mother may read. These are allowlists, so a field added
// to a model later stays private until someone adds it here on purpose.

const pick = (source, fields) => {
  const result = {};
  for (const field of fields) if (source[field] !== undefined) result[field] = source[field];
  return result;
};

const COMMON_DOSE_FIELDS = ['_id', 'babyId', 'doseKey', 'state', 'reviewRequired', 'updatedAt'];
const CLINICAL_FIELDS = [...COMMON_DOSE_FIELDS, 'administeredOn', 'administeredAt', 'administeredBy', 'facility', 'lotNumber', 'route', 'site', 'remarks', 'immediateReaction', 'aefi', 'historical'];
// `reason` holds a follow-up reason here. On an administered dose it holds an
// internal correction reason, which is why the clinical list leaves it out.
const FOLLOW_UP_FIELDS = [...COMMON_DOSE_FIELDS, 'followUpOn', 'reason'];
const BABY_FIELDS = ['_id', 'name', 'temporaryName', 'dateOfBirth', 'age', 'motherMasterResidentId', 'scheduleVersion'];
const SCHEDULE_FIELDS = ['version', 'title', 'source', 'effectiveOn', 'activationStatus', 'dueWindowDays', 'slots', 'vaccines'];

const isVoidMarker = (record) => record?.state === 'void' && !record.followUpOn;

// Older installed apps call record.history.map, so the empty array stays.
const forResidentDose = (record) => {
  if (record.state === 'administered') return {...pick(record, CLINICAL_FIELDS), history: []};
  if (record.followUpOn && (record.state === 'deferred' || record.state === 'void')) return {...pick(record, FOLLOW_UP_FIELDS), history: []};
  // A void keeps its place while dose views are built: without it the dose would
  // look unrecorded, read as Overdue, and be offered a visit it should not get.
  if (isVoidMarker(record)) return {doseKey: record.doseKey, state: 'void', history: []};
  return null;
};

const forResidentRecords = (records) => records.map(forResidentDose).filter(Boolean);

const forResidentDoseViews = (doses) => doses.map((dose) => (isVoidMarker(dose.record) ? {...dose, record: null} : dose));

const finalizedOnly = (records) => records.filter((record) => !isVoidMarker(record));

const forResidentBaby = (baby) => pick(baby, BABY_FIELDS);

const forResidentSchedule = (schedule) => pick(schedule, SCHEDULE_FIELDS);

const forResidentProgramRecord = (record) => {
  if (!record) return record;
  const {workflowStatus, ...visible} = record;
  return visible;
};

module.exports = {forResidentRecords, forResidentDoseViews, finalizedOnly, forResidentBaby, forResidentSchedule, forResidentProgramRecord};
