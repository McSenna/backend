"use strict";

const {
  createMissionSchedule,
  updateMissionSchedule,
  deleteMissionSchedule,
} = require("./mission/missionMutationController");
const {
  listMissionSchedules,
  getMissionSchedule,
  getConsultationCategories,
} = require("./mission/missionQueryController");
const { getAvailableSlots } = require("./mission/availableSlotsController");

module.exports = {
  createMissionSchedule,
  updateMissionSchedule,
  deleteMissionSchedule,
  listMissionSchedules,
  getMissionSchedule,
  getConsultationCategories,
  getAvailableSlots,
};
