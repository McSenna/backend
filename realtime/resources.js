"use strict";

// The realtime contract. Kept in step with RealtimeResource in the app's
// src/types/realtime.ts. A resource name is a REST view, not a collection: the
// same appointment is "appointment" in the staff queue and "myAppointment" in a
// resident's list, because the two GETs return different shapes and an event
// name must always carry one shape.
const RESOURCES = Object.freeze([
  "appointment",
  "myAppointment",
  "medicalRecord",
  "myMedicalRecord",
  "missionSchedule",
  "inventoryItem",
  "announcement",
  "adminAnnouncement",
  "supportTicket",
  "adminSupportTicket",
  "user",
  "resident",
  "userRequest",
  "masterResident",
  "notification",
  "systemLog",
  "profile",
]);

// created/updated carry the full record, deleted carries { id }. "resync" has
// no payload and tells clients to refetch that list: used when one change
// reshapes a whole view (a bulk import, an account relinked to other records)
// or when the server may have missed changes.
const ACTIONS = Object.freeze(["created", "updated", "deleted", "resync"]);

const isResource = (value) => RESOURCES.includes(value);

const isAction = (value) => ACTIONS.includes(value);

const eventName = (resource, action) => `${resource}:${action}`;

module.exports = { RESOURCES, ACTIONS, isResource, isAction, eventName };
