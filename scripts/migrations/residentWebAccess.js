"use strict";
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const {
  initializeResidentWebAccess,
} = require("../../services/residentWebAccess");
connectDB()
  .then(initializeResidentWebAccess)
  .then(() => mongoose.disconnect())
  .catch(async () => {
    process.stderr.write(
      "Resident web access migration failed. Check database configuration.\n",
    );
    await mongoose.disconnect();
    process.exitCode = 1;
  });
