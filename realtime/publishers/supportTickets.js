"use strict";

const SupportTicket = require("../../models/SupportTicket");
const { toTicket } = require("../../services/support/supportTicketSerializer");
const { broadcast } = require("../broadcast");
const { adminRoom, roleRoom, STAFF_ROLES, userRoom } = require("../rooms");
const { idOf, splitChanges } = require("./shared");

// Two views of one ticket: the requester's own list (any role can file one)
// and the admin queue. They are separate resources so an admin's "my requests"
// screen never picks up other people's tickets.
const publish = async (changes) => {
  const { liveIds, deletedIds, actionOf } = splitChanges(changes);

  if (liveIds.length > 0) {
    const tickets = await SupportTicket.find({ _id: { $in: liveIds } }).lean();
    for (const ticket of tickets) {
      const action = actionOf(ticket._id);
      const view = toTicket(ticket);
      broadcast("supportTicket", action, view, [userRoom(idOf(ticket.requesterUserId))]);
      broadcast("adminSupportTicket", action, view, [adminRoom()]);
    }
  }

  for (const id of deletedIds) {
    broadcast("adminSupportTicket", "deleted", { id }, [adminRoom()]);
    broadcast("supportTicket", "deleted", { id }, ["resident", ...STAFF_ROLES].map(roleRoom));
  }
};

module.exports = { name: "supportTickets", model: SupportTicket, publish };
