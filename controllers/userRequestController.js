"use strict";

const { getIdTypes } = require("./userRequest/idTypesController");
const { getUserRequests } = require("./userRequest/requestListController");
const { getUserRequestById } = require("./userRequest/requestDetailController");
const { serveIdDocument } = require("./userRequest/documentController");
const {
  approveUserRequest,
  rejectUserRequest,
} = require("./userRequest/verificationDecisionController");

module.exports = {
  getIdTypes,
  getUserRequests,
  getUserRequestById,
  serveIdDocument,
  approveUserRequest,
  rejectUserRequest,
};
