'use strict';
const series = (key, slots) => slots.map((slot, index) => ({key:`${key}-${index + 1}`,label:`Dose ${index + 1}`,slot}));
const INITIAL_SCHEDULE = {
  version:'ph-nip-infant-2026-review-1',
  title:'SCHEDULE NG PAGBIBIGAY NG BAKUNA PARA SA MGA BATANG ISANG TAON PABABA',
  source:'https://www.pidsphil.org/home/wp-content/uploads/2026/06/Revised-July-2026-PIDSP-Immunization-Calendar_ea6.pdf',
  effectiveOn:'2026-07-01',
  activationStatus:'pending_verification',
  verificationNote:'Routine NIP subset requested for this health center. Sources checked 2026-10-23. Local clinical approval and due-window configuration required before activation.',
  dueWindowDays:7,
  reminderDays:[7,1,0],
  slots:[{key:'birth',label:'At birth',days:0},{key:'w6',label:'6 weeks',days:42},{key:'w10',label:'10 weeks',days:70},{key:'w14',label:'14 weeks',days:98},{key:'m9',label:'9 months',months:9},{key:'m12',label:'12 months',months:12}],
  vaccines:[
    {key:'bcg',name:'BCG',disease:'Severe forms of tuberculosis',route:'Intradermal',doses:series('bcg',['birth'])},
    {key:'hepb',name:'Hepatitis B',disease:'Hepatitis B',route:'Intramuscular',doses:[{key:'hepb-1',label:'Birth dose',slot:'birth'}]},
    {key:'penta',name:'Pentavalent (DPT-HepB-Hib)',disease:'Diphtheria, pertussis, tetanus, hepatitis B, and Hib infections',route:'Intramuscular',doses:series('penta',['w6','w10','w14'])},
    {key:'opv',name:'Oral Polio Vaccine (OPV)',disease:'Polio',route:'Oral (by mouth)',doses:series('opv',['w6','w10','w14'])},
    {key:'ipv',name:'Inactivated Polio Vaccine (IPV)',disease:'Polio',route:'Intramuscular',doses:series('ipv',['w14','m9'])},
    {key:'pcv',name:'Pneumococcal Conjugate Vaccine (PCV)',disease:'Pneumococcal disease, including pneumonia and meningitis',route:'Intramuscular',doses:series('pcv',['w6','w10','w14'])},
    {key:'mmr',name:'Measles, Mumps, Rubella (MMR)',disease:'Measles, mumps, and rubella',route:'Subcutaneous',doses:series('mmr',['m9','m12'])},
  ],
};
module.exports = { INITIAL_SCHEDULE };
