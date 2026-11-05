"use strict";

const Appointment = require("../../models/Appointment");
const { staffAppointmentQuery } = require("../../services/appointment/queueService");
const { residentAppointmentQuery } = require("../../services/appointment/bookingService");
const { withQueueRole } = require("../../services/queueScope");
const { appointmentForResident } = require("../../services/medicalRecord/residentRecordView");
const { broadcast } = require("../broadcast");
const { STAFF_ROOM, roleRoom, serviceOwnerRooms, userRoom } = require("../rooms");
const { idOf, splitChanges } = require("./shared");

const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    const filter = { _id: { $in: liveIds } };
    const [staffRows, residentRows] = await Promise.all([
      staffAppointmentQuery(filter).lean(),
      residentAppointmentQuery(filter).lean(),
    ]);

    // Staff GETs are scoped by service: admins see all, others their own queue.
    for (const row of staffRows) {
      broadcast("appointment", actionOf(row._id), withQueueRole(row), serviceOwnerRooms(row.consultationType));
    }
    for (const row of await require('../../services/immunization/appointmentAccess').protectedAppointmentRows(residentRows)) {
      broadcast("myAppointment", actionOf(row._id), appointmentForResident(row), [userRoom(idOf(row.resident))]);
    }
  }

  // The app never hard-deletes appointments; a script might. The owner is
  // unknown once the document is gone, so only the id goes out.
  for (const id of deletedIds) {
    broadcast("appointment", "deleted", { id }, [STAFF_ROOM]);
    broadcast("myAppointment", "deleted", { id }, [roleRoom("resident")]);
  }
};

module.exports = { name: "appointments", model: Appointment, publish };
