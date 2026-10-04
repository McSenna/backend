"use strict";

const { getQueueRole } = require("../config/consultationCategories");

// Every socket joins its own user room and its role room; staff also join
// "staff". Publishers pick rooms that mirror the REST guard of the GET a record
// comes from, so a socket never receives a record its account could not load.
const STAFF_ROLES = Object.freeze(["admin", "doctor", "midwife", "bhw"]);

const STAFF_ROOM = "staff";

const userRoom = (userId) => `user:${String(userId)}`;

const roleRoom = (role) => `role:${role}`;

const adminRoom = () => roleRoom("admin");

/** The admin room plus the role that runs this service (doctor, midwife or bhw). */
const serviceOwnerRooms = (serviceKey) => [adminRoom(), roleRoom(getQueueRole(serviceKey))];

const roomsForAccount = ({ userId, role }) => [
  userRoom(userId),
  roleRoom(role),
  ...(STAFF_ROLES.includes(role) ? [STAFF_ROOM] : []),
];

module.exports = {
  STAFF_ROLES,
  STAFF_ROOM,
  userRoom,
  roleRoom,
  adminRoom,
  serviceOwnerRooms,
  roomsForAccount,
};
