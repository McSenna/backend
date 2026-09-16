"use strict";

const mongoose = require("mongoose");
const { RESIDENCY } = require("../config/residency");

const residentAddressSchema = () =>
  new mongoose.Schema(
    {
      houseNumberOrPurok: { type: String, trim: true, default: "", maxlength: 100 },
      street: { type: String, trim: true, default: "", maxlength: 100 },
      barangay: { type: String, trim: true, default: RESIDENCY.barangay, maxlength: 100 },
      cityMunicipality: {
        type: String,
        trim: true,
        default: RESIDENCY.cityMunicipality,
        maxlength: 100,
      },
      province: { type: String, trim: true, default: RESIDENCY.province, maxlength: 100 },
    },
    { _id: false }
  );

module.exports = { residentAddressSchema };
