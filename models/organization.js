const mongoose = require("mongoose");

const OrganizationsSchema = new mongoose.Schema({
  organizationId: String,
  fullname: String,
  gender: String,
  address: String,
  role: String,
});

module.exports = mongoose.model("Organizations", OrganizationsSchema);