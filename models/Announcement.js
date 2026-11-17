"use strict";

const mongoose = require("mongoose");
const { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_LIMITS } = require("../config/announcements");

function requiredWhenPosted() {
  return !this.isDraft;
}

/**
 * One shared document per announcement. Every account reads the same row from
 * the feed; the per-user Notification copies only carry the inbox alert and its
 * read state.
 */
const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: ANNOUNCEMENT_LIMITS.titleMax },
    // A draft may be saved with only its title; posting needs the rest.
    message: { type: String, required: requiredWhenPosted, trim: true, default: "", maxlength: ANNOUNCEMENT_LIMITS.messageMax },
    eventAt: { type: Date, required: requiredWhenPosted, default: null },
    location: {
      type: String,
      required: requiredWhenPosted,
      default: "",
      trim: true,
      maxlength: ANNOUNCEMENT_LIMITS.locationMax,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Rows written before audiences existed read as Everyone, no end date, posted.
    audience: { type: String, enum: ANNOUNCEMENT_AUDIENCES, default: "Everyone" },
    expiresAt: { type: Date, default: null },
    // A draft is visible to admins only and has notified nobody.
    isDraft: { type: Boolean, default: false },
    recipientCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Announcement", AnnouncementSchema);
