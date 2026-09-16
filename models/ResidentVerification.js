"use strict";

const mongoose = require("mongoose");
const { maskIdNumber } = require("../config/idVerification");

const ResidentVerificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    idType: {
      type: String,
      required: [true, "ID Type is required"],
      trim: true,
      index: true,
    },
    idTypeName: {
      type: String,
      required: [true, "ID Type Name is required"],
      trim: true,
    },
    idNumber: {
      type: String,
      required: [true, "ID Number is required"],
      trim: true,
      maxlength: [100, "ID Number must not exceed 100 characters"],
    },
    idFilePath: {
      type: String,
      required: [true, "ID File Path is required"],
      trim: true,
    },
    idFileName: {
      type: String,
      default: "document",
      trim: true,
    },
    idMimeType: {
      type: String,
      required: true,
      trim: true,
    },
    idFileSize: {
      type: Number,
      default: 0,
    },
    verificationStatus: {
      type: String,
      enum: {
        values: ["pending", "approved", "rejected"],
        message: "Status must be pending, approved, or rejected",
      },
      default: "pending",
      index: true,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
    rejectionRemarks: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: "resident_verifications",
  }
);

ResidentVerificationSchema.index({ verificationStatus: 1, createdAt: -1 });
ResidentVerificationSchema.index({ user: 1, verificationStatus: 1 });

ResidentVerificationSchema.methods.toAdminSummary = function () {
  return {
    _id: this._id,
    user: this.user,
    idType: this.idType,
    idTypeName: this.idTypeName,
    maskedIdNumber: maskIdNumber(this.idNumber),
    idMimeType: this.idMimeType,
    idFileSize: this.idFileSize,
    verificationStatus: this.verificationStatus,
    verifiedBy: this.verifiedBy,
    verifiedAt: this.verifiedAt,
    rejectionReason: this.rejectionReason,
    rejectionRemarks: this.rejectionRemarks,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("ResidentVerification", ResidentVerificationSchema);
