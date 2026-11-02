"use strict";
const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    _id: { type: String, default: "resident-web" },
    enabled: { type: Boolean, required: true, default: false },
    revision: { type: Number, required: true, default: 0 },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);
module.exports = mongoose.model("ResidentWebPolicy", schema);
