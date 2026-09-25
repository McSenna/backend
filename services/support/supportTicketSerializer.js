"use strict";

// Tickets written by the earlier support backend stored subdocuments with only a Mongo `_id`.
// That `_id` is persistent, so it is a stable stand-in when the `id` field is absent.
const subdocumentId = (subdocument) =>
  subdocument.id ?? (subdocument._id ? String(subdocument._id) : null);

const toMessage = (message) => ({
  id: subdocumentId(message),
  body: message.body,
  authorName: message.authorName,
  authorRole: message.authorRole,
  isStaffReply: Boolean(message.isStaffReply),
  createdAt: message.createdAt ?? null,
});

const toAttachment = (attachment) => ({
  id: subdocumentId(attachment),
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  fileSize: attachment.fileSize,
});

const toTicketSummary = (ticket) => ({
  id: String(ticket._id),
  ticketNumber: ticket.ticketNumber,
  subject: ticket.subject,
  category: ticket.category,
  status: ticket.status,
  requesterName: ticket.requesterName,
  createdAt: ticket.createdAt ?? null,
  updatedAt: ticket.updatedAt ?? null,
  lastActivityAt: ticket.lastActivityAt ?? null,
});

const toTicket = (ticket) => ({
  ...toTicketSummary(ticket),
  description: ticket.description,
  contactEmail: ticket.contactEmail,
  contactNumber: ticket.contactNumber ?? "",
  requesterRole: ticket.requesterRole,
  resolvedAt: ticket.resolvedAt ?? null,
  closedAt: ticket.closedAt ?? null,
  attachments: (ticket.attachments ?? []).map(toAttachment),
  messages: (ticket.messages ?? []).map(toMessage),
});

module.exports = { toMessage, toTicketSummary, toTicket };
