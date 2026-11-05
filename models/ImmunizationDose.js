'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  babyId:{type:mongoose.Schema.Types.ObjectId,ref:'Baby',required:true,immutable:true},
  doseKey:{type:String,required:true,immutable:true},
  scheduleVersion:{type:String,required:true,immutable:true},
  state:{type:String,enum:['administered','deferred','void','pending'],required:true},
  workflowStatus:{type:String,enum:['draft','completed']},
  createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},
  updatedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},
  administeredOn:String, administeredAt:String, administeredBy:{type:String,maxlength:120},
  recordedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
  facility:{type:String,maxlength:160},lotNumber:{type:String,maxlength:120},route:{type:String,maxlength:80},site:{type:String,maxlength:120},
  remarks:{type:String,maxlength:2000}, immediateReaction:{type:String,maxlength:2000}, aefi:{type:String,maxlength:2000}, historical:{type:Boolean,default:false},reviewRequired:{type:Boolean,default:true},
  followUpOn:String,reason:{type:String,maxlength:500}, revision:{type:Number,default:0},
  history:{type:[new mongoose.Schema({action:{type:String,required:true},reason:String,actor:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},at:{type:Date,required:true},previous:{type:mongoose.Schema.Types.Mixed,default:null}},{_id:false})],default:[]},
},{timestamps:true});
// Same scheduled dose remains one row even after void; its history is retained.
schema.index({babyId:1,doseKey:1},{unique:true});
module.exports = mongoose.model('ImmunizationDose',schema);
