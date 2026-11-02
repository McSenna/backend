'use strict';
const mongoose = require('mongoose');
const dose = new mongoose.Schema({key:{type:String,required:true},label:{type:String,required:true},slot:{type:String,required:true}},{_id:false});
const vaccine = new mongoose.Schema({key:String,name:String,disease:String,route:String,doses:[dose]},{_id:false});
const slot = new mongoose.Schema({key:String,label:String,days:Number,months:Number},{_id:false});
const schema = new mongoose.Schema({
  version:{type:String,required:true,unique:true,immutable:true},
  title:{type:String,required:true}, source:{type:String,required:true}, effectiveOn:{type:String,required:true},
  activationStatus:{type:String,enum:['active','pending_verification'],default:'pending_verification'},
  verificationNote:{type:String,default:''}, verifiedBy:{type:String,default:''}, verifiedOn:{type:String,default:''},
  dueWindowDays:{type:Number,min:0,required:true}, reminderDays:{type:[Number],default:[7,1,0]},
  slots:{type:[slot],required:true}, vaccines:{type:[vaccine],required:true},
},{timestamps:true});
module.exports = mongoose.model('VaccineSchedule',schema);
