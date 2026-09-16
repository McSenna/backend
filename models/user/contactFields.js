"use strict";

const { residentAddressSchema } = require("../residentAddress");

const contactFields = {
  dateOfBirth: {
    type: Date,
    required: [true, "Date of birth is required"],
  },
  address: {
    type: String,
    required: [true, "Address is required"],
    trim: true,
    maxlength: [255, "Address must not exceed 255 characters"],
  },
  addressDetails: {
    type: residentAddressSchema(),
    default: () => ({}),
  },

  phone: {
    type: String,
    default: "",
    trim: true,
    maxlength: [20, "Contact number must not exceed 20 characters"],
  },
};

module.exports = { contactFields };
