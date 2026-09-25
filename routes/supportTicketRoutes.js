"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  getSupportOptions,
  createSupportTicket,
  getMySupportTickets,
  getMySupportTicket,
  replyToMySupportTicket,
  getAdminSupportTickets,
  getAdminSupportTicket,
  updateAdminTicketStatus,
  replyAsAdmin,
} = require("../controllers/supportTicketController");

const router = express.Router();

const adminOnly = roleCheck("admin");

// Any signed-in account can ask for help; each user only ever sees their own tickets.
router.get("/support/options", auth, getSupportOptions);
router.post("/support/tickets", auth, createSupportTicket);
router.get("/support/tickets/my", auth, getMySupportTickets);
router.get("/support/tickets/:ticketId", auth, getMySupportTicket);
router.post("/support/tickets/:ticketId/messages", auth, replyToMySupportTicket);

router.get("/admin/support/tickets", auth, adminOnly, getAdminSupportTickets);
router.get("/admin/support/tickets/:ticketId", auth, adminOnly, getAdminSupportTicket);
router.patch("/admin/support/tickets/:ticketId/status", auth, adminOnly, updateAdminTicketStatus);
router.post("/admin/support/tickets/:ticketId/messages", auth, adminOnly, replyAsAdmin);

module.exports = router;
