"use strict";

const Appointment = require("../../models/Appointment");
const MissionSchedule = require("../../models/MissionSchedule");
const { notFound } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const loadAppointmentOrFail = async (id) => {
  const appointment = await Appointment.findById(id);
  if (!appointment) {
    throw notFound("Appointment not found.", ERROR_CODES.APPOINTMENT_NOT_FOUND);
  }
  return appointment;
};

const loadMissionOrFail = async (missionScheduleId) => {
  const mission = await MissionSchedule.findById(missionScheduleId);
  if (!mission) {
    throw notFound("Mission schedule not found.", ERROR_CODES.MISSION_NOT_FOUND);
  }
  return mission;
};

module.exports = { loadAppointmentOrFail, loadMissionOrFail };
