"use strict";

const crypto = require("crypto");
const SupportTicket = require("../models/SupportTicket");
const asyncHandler = require("../utils/asyncHandler");
const { badRequest, notFound } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const { isValidObjectId } = require("../utils/objectId");
const { SUPPORT_CONTACT, SUPPORT_STATUSES, SUPPORT_LIMITS } = require("../config/support");
const supportTickets = require("../services/support/supportTicketService");
const {
  toMessage,
  toTicket,
  toTicketSummary,
} = require("../services/support/supportTicketSerializer");

const ADMIN_SORTS = {
  recent: { lastActivityAt: -1 },
  oldest: { createdAt: 1 },
  created: { createdAt: -1 },
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ticketNotFound = () => notFound("Support ticket not found.");

const assertTicketId = (ticketId) => {
  if (!isValidObjectId(ticketId)) throw ticketNotFound();
};

// ─── Requester endpoints ──────────────────────────────────────────────────────

exports.getSupportOptions = (_req, res) => {
  res.status(200).json({ success: true, contact: SUPPORT_CONTACT });
};

exports.createSupportTicket = asyncHandler(async (req, res) => {
  const ticket = await supportTickets.createTicket(req.user.userId, req.body ?? {});
  res.status(201).json({ success: true, ticket });
});

exports.getMySupportTickets = asyncHandler(async (req, res) => {
  const page = await supportTickets.listOwnTickets(req.user.userId, req.query);
  res.status(200).json({ success: true, ...page });
});

exports.getMySupportTicket = asyncHandler(async (req, res) => {
  const ticket = await supportTickets.getOwnTicket(req.user.userId, req.params.ticketId);
  res.status(200).json({ success: true, ticket });
});

exports.replyToMySupportTicket = asyncHandler(async (req, res) => {
  const message = await supportTickets.replyToOwnTicket(
    req.user.userId,
    req.params.ticketId,
    req.body?.body
  );
  res.status(201).json({ success: true, message });
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────

exports.getAdminSupportTickets = asyncHandler(async (req, res) => {
  const { status, category, search, sort } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = SUPPORT_LIMITS.defaultPageSize;
  const skip = (page - 1) * limit;

  const filter = {};
  if (status && status !== "all") filter.status = String(status);
  if (category && category !== "all") filter.category = String(category);

  const term = typeof search === "string" ? search.trim() : "";
  if (term) {
    const pattern = { $regex: escapeRegex(term), $options: "i" };
    filter.$or = [
      { ticketNumber: pattern },
      { subject: pattern },
      { description: pattern },
      { requesterName: pattern },
      { contactEmail: pattern },
    ];
  }

  // Counts ignore the status filter so every status tab keeps showing its total.
  const { status: _status, ...countFilter } = filter;

  const [tickets, total, statusCounts] = await Promise.all([
    SupportTicket.find(filter)
      .sort(ADMIN_SORTS[sort] ?? ADMIN_SORTS.created)
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportTicket.countDocuments(filter),
    SupportTicket.aggregate([
      { $match: countFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  res.status(200).json({
    success: true,
    tickets: tickets.map(toTicketSummary),
    total,
    page,
    hasMore: skip + tickets.length < total,
    statusCounts: Object.fromEntries(statusCounts.map(({ _id, count }) => [_id, count])),
  });
});

exports.getAdminSupportTicket = asyncHandler(async (req, res) => {
  assertTicketId(req.params.ticketId);

  const ticket = await SupportTicket.findById(req.params.ticketId).lean();
  if (!ticket) throw ticketNotFound();

  res.status(200).json({ success: true, ticket: toTicket(ticket) });
});

exports.updateAdminTicketStatus = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const { status } = req.body ?? {};

  assertTicketId(ticketId);
  if (!SUPPORT_STATUSES.includes(status)) {
    throw badRequest("Invalid status.", ERROR_CODES.VALIDATION_ERROR);
  }

  const existing = await SupportTicket.findById(ticketId).select("resolvedAt closedAt").lean();
  if (!existing) throw ticketNotFound();

  const now = new Date();
  const update = { status, lastActivityAt: now };
  if (status === "resolved" && !existing.resolvedAt) update.resolvedAt = now;
  if (status === "closed" && !existing.closedAt) update.closedAt = now;

  const ticket = await SupportTicket.findByIdAndUpdate(ticketId, update, {
    returnDocument: "after",
    runValidators: true,
  }).lean();
  if (!ticket) throw ticketNotFound();

  res.status(200).json({ success: true, ticket: toTicket(ticket) });
});

exports.replyAsAdmin = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;

  assertTicketId(ticketId);
  const body = supportTickets.validateMessageBody(req.body?.body);
  const account = await supportTickets.loadAccount(req.user.userId);

  const message = {
    id: crypto.randomUUID(),
    body,
    authorName: account.fullname || "Admin",
    authorRole: "admin",
    isStaffReply: true,
    createdAt: new Date(),
  };

  const ticket = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { $push: { messages: message }, $set: { lastActivityAt: message.createdAt } },
    { returnDocument: "after", runValidators: true }
  )
    .select("_id")
    .lean();
  if (!ticket) throw ticketNotFound();

  res.status(201).json({ success: true, message: toMessage(message) });
});
