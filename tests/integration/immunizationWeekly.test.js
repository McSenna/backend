"use strict";
// Mother-selected booking is superseded by automatic Thursday assignment.
// Worker capacity and concurrency are covered by immunizationAutomatic.test.js.
const {createChecker,startHarness,createUser,upcomingDateKey,localAt,finish}=require('./helpers/appointmentHarness');
const Appointment=require('../../models/Appointment');
const MissionSchedule=require('../../models/MissionSchedule');
const run=async({request},check)=>{
 const midwife=await createUser('midwife');
 const mother=await createUser('resident');
 const other=await createUser('resident');
 const thursday=upcomingDateKey(4);
 const body={consultationType:'immunization',childName:'Fictional child',childDateOfBirth:'2025-01-01',appointmentDate:thursday,requestKey:'automatic-policy-fixture'};
 const options=await request('/appointments/booking-options?consultationType=immunization',{token:mother.token});
 check('mothers are not offered a Thursday picker',options.status===400 && /assigned automatically/.test(options.body.message));
 const attempted=await Promise.all([thursday,upcomingDateKey(0),undefined].map(appointmentDate=>request('/appointments',{method:'POST',token:mother.token,body:{...body,appointmentDate}})));
 check('direct requests cannot choose a Thursday, another weekday or an omitted day',attempted.every(row=>row.status===400));
 check('refused requests create no appointments',await Appointment.countDocuments()===0);
 const start=localAt(thursday,'08:00');
 const legacy=await Appointment.create({resident:mother.user._id,consultationType:'immunization',childName:'Fictional legacy child',childDateOfBirth:new Date('2025-01-01'),status:'confirmed',ageTier:0,prioritySortKey:0,slotStart:start,slotEnd:new Date(start.getTime()+600000),immunizationSlotKey:start.toISOString()});
 const move=who=>request(`/appointments/${legacy._id}/reschedule`,{method:'PATCH',token:who.token,body:{appointmentDate:upcomingDateKey(4,1)}});
 check('the owner cannot select a replacement date',(await move(mother)).status===400);
 check('another mother cannot change the visit',(await move(other)).status===403);
 const mine=await request('/appointments/me',{token:mother.token});
 check('existing appointments remain readable',mine.body.appointments.some(row=>String(row._id)===String(legacy._id)));
 check('rejected changes preserve the reserved time',(await Appointment.findById(legacy._id).lean()).slotStart.toISOString()===start.toISOString());
 const pending=await Appointment.create({resident:other.user._id,consultationType:'immunization',ageTier:0,prioritySortKey:0,status:'pending'});
 const placed=await request(`/appointments/${pending._id}/assign`,{method:'PATCH',token:midwife.token,body:{}});
 check('midwives retain placement of ambiguous legacy requests',placed.status===200 && new Date(placed.body.appointment.slotStart).getDay()===4);
 check('staff placement does not use a medical mission',placed.body.appointment.missionSchedule===null && await MissionSchedule.countDocuments()===0);
};
(async()=>{
 const {check,tally}=createChecker();const harness=await startHarness();
 try{await run(harness,check);}catch(error){check('suite completed',false,error.stack);}
 await finish(harness,tally);
})();
