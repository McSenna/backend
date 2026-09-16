"use strict";

const { CIVIL_STATUS_OPTIONS } = require("../../config/residency");

const identityFields = {
  firstName: {
    type: String,
    trim: true,
    default: "",
    maxlength: [50, "First name must not exceed 50 characters"],
  },
  middleName: {
    type: String,
    trim: true,
    default: "",
    maxlength: [50, "Middle name must not exceed 50 characters"],
  },
  surname: {
    type: String,
    trim: true,
    default: "",
    maxlength: [50, "Surname must not exceed 50 characters"],
  },
  suffix: {
    type: String,
    trim: true,
    default: "",
    maxlength: [20, "Suffix must not exceed 20 characters"],
  },
  civilStatus: {
    type: String,
    trim: true,
    lowercase: true,
    default: "",
    enum: {
      values: ["", ...CIVIL_STATUS_OPTIONS],
      message: "Civil status must be single, married, widowed, or separated",
    },
  },
  fullname: {
    type: String,
    required: [true, "Full name is required"],
    trim: true,
    minlength: [2, "Full name must be at least 2 characters"],
    maxlength: [100, "Full name must not exceed 100 characters"],
  },

  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    index: true,
  },

  profilePhoto: {
    type: String,
    default: "",
    trim: true,
  },

  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: [8, "Password must be at least 8 characters"],
    select: false,
  },
  gender: {
    type: String,
    enum: {
      values: ["male", "female", "other"],
      message: 'Gender must be "male", "female", or "other"',
    },
    required: [true, "Gender is required"],
  },
};

module.exports = { identityFields };
