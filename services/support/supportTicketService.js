"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const SupportTicket = require("../../models/SupportTicket");
const User = require("../../models/User");
const { badRequest, conflict, notFound, unauthorized } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { isValidObjectId } = require("../../utils/objectId");
const { SUPPORT_CATEGORIES, SUPPORT_LIMITS } = require("../../config/support");
const { saveSupportAttachments, deleteSupportAttachments } = require("./supportAttachmentStorage");
const { toMessage, toTicket, toTicketSummary } = require("./supportTicketSerializer");

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;
const DUPLICATE_KEY = 11000;
const TICKET_NUMBER_ATTEMPTS = 3;

// Statuses where a requester reply means the ticket needs staff attention again.
const REOPEN_ON_REPLY = new Set(["awaiting_user", "resolved"]);

const ticketNotFound = () => notFound("Support ticket not found.");

const fieldError = (field, message) =>
  badRequest(message, ERROR_CODES.VALIDATION_ERROR, { fieldErrors: { [field]: message } });

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const validateTicketInput = (input) => {
  const category = asText(input.category);
  const subject = asText(input.subject);
  const description = asText(input.description);
  const contactNumber = asText(input.contactNumber);

  if (!SUPPORT_CATEGORIES.includes(category)) {
    throw fieldError("category", "Select the concern category that fits your request.");
  }
  if (subject.length < SUPPORT_LIMITS.subjectMin || subject.length > SUPPORT_LIMITS.subjectMax) {
    throw fieldError(
      "subject",
      `Subject must be between ${SUPPORT_LIMITS.subjectMin} and ${SUPPORT_LIMITS.subjectMax} characters.`
    );
  }
  if (
    description.length < SUPPORT_LIMITS.descriptionMin ||
    description.length > SUPPORT_LIMITS.descriptionMax
  ) {
    throw fieldError(
      "description",
      `Description must be between ${SUPPORT_LIMITS.descriptionMin} and ${SUPPORT_LIMITS.descriptionMax} characters.`
    );
  }
  if (contactNumber && !PHONE_PATTERN.test(contactNumber)) {
    throw fieldError("contactNumber", "Enter a valid contact number.");
  }

  return { category, subject, description, contactNumber };
};

const validateMessageBody = (body) => {
  const text = asText(body);
  if (!text) {
    throw badRequest("Message body is required.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (text.length > SUPPORT_LIMITS.messageMax) {
    throw badRequest(
      `Message must not exceed ${SUPPORT_LIMITS.messageMax} characters.`,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
  return text;
};

const loadAccount = async (userId) => {
  const account = await User.findById(userId).select("fullname email phone role").lean();
  if (!account) throw unauthorized();
  return account;
};

const generateTicketNumber = (date = new Date()) => {
  const stamp = date.toISOString().slice(2, 10).replace(/-/g, "");
  return `TKT-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
};

const insertWithTicketNumber = async (fields) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await SupportTicket.create({ ...fields, ticketNumber: generateTicketNumber() });
    } catch (error) {
      const isNumberClash = error?.code === DUPLICATE_KEY && error?.keyPattern?.ticketNumber;
      if (!isNumberClash || attempt >= TICKET_NUMBER_ATTEMPTS) throw error;
    }
  }
};

const createTicket = async (userId, input) => {
  const fields = validateTicketInput(input);
  const account = await loadAccount(userId);
  const attachments = await saveSupportAttachments(input.attachments);

  try {
    const ticket = await insertWithTicketNumber({
      ...fields,
      contactNumber: fields.contactNumber || account.phone || "",
      requesterName: account.fullname,
      requesterRole: account.role,
      requesterUserId: account._id,
      contactEmail: account.email,
      attachments,
      lastActivityAt: new Date(),
    });
    return toTicket(ticket.toObject());
  } catch (error) {
    await deleteSupportAttachments(attachments.map((file) => file.storedFileName));
    throw error;
  }
};

const readPaging = (query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const requested = parseInt(query.limit, 10) || SUPPORT_LIMITS.defaultPageSize;
  const limit = Math.min(Math.max(requested, 1), SUPPORT_LIMITS.maxPageSize);
  return { page, limit, skip: (page - 1) * limit };
};

const listOwnTickets = async (userId, query) => {
  const { page, limit, skip } = readPaging(query);
  const filter = { requesterUserId: new mongoose.Types.ObjectId(String(userId)) };

  const [tickets, total, statusCounts] = await Promise.all([
    SupportTicket.find(filter)
      .select("ticketNumber subject category status requesterName createdAt updatedAt lastActivityAt")
      .sort({ lastActivityAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
    SupportTicket.aggregate([
      { $match: filter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  return {
    tickets: tickets.map(toTicketSummary),
    total,
    page,
    hasMore: skip + tickets.length < total,
    statusCounts: Object.fromEntries(statusCounts.map(({ _id, count }) => [_id, count])),
  };
};

const findOwnTicket = async (userId, ticketId) => {
  if (!isValidObjectId(ticketId)) throw ticketNotFound();

  const ticket = await SupportTicket.findOne({ _id: ticketId, requesterUserId: userId }).lean();
  if (!ticket) throw ticketNotFound();
  return ticket;
};

const getOwnTicket = async (userId, ticketId) => toTicket(await findOwnTicket(userId, ticketId));

const replyToOwnTicket = async (userId, ticketId, body) => {
  const text = validateMessageBody(body);
  const ticket = await findOwnTicket(userId, ticketId);

  if (ticket.status === "closed") {
    throw conflict("This support ticket is closed. Please submit a new request.");
  }

  const account = await loadAccount(userId);
  const now = new Date();
  const message = {
    id: crypto.randomUUID(),
    body: text,
    authorName: account.fullname,
    authorRole: account.role,
    isStaffReply: false,
    createdAt: now,
  };

  const update = { $push: { messages: message }, $set: { lastActivityAt: now } };
  if (REOPEN_ON_REPLY.has(ticket.status)) {
    update.$set.status = "open";
    update.$set.resolvedAt = null;
  }

  await SupportTicket.updateOne({ _id: ticket._id }, update, { runValidators: true });
  return toMessage(message);
};

module.exports = {
  createTicket,
  listOwnTickets,
  getOwnTicket,
  replyToOwnTicket,
  validateMessageBody,
  loadAccount,
};
