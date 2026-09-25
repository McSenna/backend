"use strict";

const mongoose = require("mongoose");
const { SUPPORT_CATEGORIES, SUPPORT_STATUSES, SUPPORT_ROLES } = require("../config/support");

const supportAttachmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    // Name of the file inside storage/support; never sent to clients.
    storedFileName: { type: String, required: true },
  },
  { _id: false }
);

const supportMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    body: { type: String, required: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, enum: SUPPORT_ROLES, required: true },
    isStaffReply: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, unique: true, required: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category: { type: String, enum: SUPPORT_CATEGORIES, required: true },
    status: { type: String, enum: SUPPORT_STATUSES, default: "open" },
    requesterName: { type: String, required: true },
    requesterRole: { type: String, enum: SUPPORT_ROLES, required: true },
    requesterUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contactEmail: { type: String, required: true, trim: true, lowercase: true },
    contactNumber: { type: String, default: "", trim: true },
    attachments: [supportAttachmentSchema],
    messages: [supportMessageSchema],
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

supportTicketSchema.index({ requesterUserId: 1, lastActivityAt: -1 });
supportTicketSchema.index({ status: 1, lastActivityAt: -1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
