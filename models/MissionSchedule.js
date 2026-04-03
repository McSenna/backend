"use strict";

const mongoose = require("mongoose");

const CategoryOnMissionSchema = new mongoose.Schema(
  {
    categoryKey: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 1, max: 240 },
  },
  { _id: false }
);

const MissionScheduleSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    morningStart: { type: String, default: "08:00" },
    morningEnd: { type: String, default: "12:00" },
    afternoonStart: { type: String, default: "13:00" },
    afternoonEnd: { type: String, default: "17:00" },
    categories: { type: [CategoryOnMissionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    notes: { type: String, default: "", maxlength: 2000 },
  },
  { timestamps: true }
);

MissionScheduleSchema.index({ date: 1, createdAt: -1 });

module.exports = mongoose.model("MissionSchedule", MissionScheduleSchema);
