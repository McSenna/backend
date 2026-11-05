'use strict';
const DAY_MS = 86400000;

// The care documented on a visit day. The ledger stays the only clinical source,
// so a later correction to a dose's date also moves it out of this visit.
const visitDoseFilter = (babyId,visitDay) => {
  const start = new Date(`${visitDay}T00:00:00+08:00`);
  return {babyId,$or:[
    {state:'administered',administeredOn:visitDay},
    {state:{$in:['deferred','void']},history:{$elemMatch:{action:{$ne:'draft_saved'},at:{$gte:start,$lt:new Date(start.getTime()+DAY_MS)}}}},
  ]};
};
module.exports = {visitDoseFilter};
