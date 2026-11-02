'use strict';
const mongoose = require('mongoose');
const { parseCalendarDate } = require('../utils/calendarDate');
const schema = new mongoose.Schema({
  motherMasterResidentId:{type:String,required:true,immutable:true,index:true},
  name:{type:String,required:true,trim:true,maxlength:120},
  temporaryName:{type:Boolean,default:true},
  dateOfBirth:{type:String,required:true,immutable:true,validate:value => Boolean(parseCalendarDate(value))},
  birthRecordId:{type:String,trim:true,maxlength:120,default:''},
  scheduleVersion:{type:String,required:true,immutable:true},
  createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
  requestKey:{type:String,required:true,maxlength:64,immutable:true},
  revision:{type:Number,default:0},
  completedVisits:{type:[new mongoose.Schema({appointmentId:{type:mongoose.Schema.Types.ObjectId,ref:'Appointment'},recordId:{type:mongoose.Schema.Types.ObjectId,ref:'MedicalRecord'}},{_id:false})],default:[]},
  nameHistory:{type:[new mongoose.Schema({name:String,actor:{type:mongoose.Schema.Types.ObjectId,ref:'User'},at:Date},{_id:false})],default:[]},
}, {timestamps:true});
schema.index({createdBy:1,requestKey:1},{unique:true});
module.exports = mongoose.model('Baby',schema);
