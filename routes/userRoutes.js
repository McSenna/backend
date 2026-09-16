"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const { getAllUsers, updateUserStatus } = require("../controllers/userController");
const { getResidents } = require("../controllers/residentDirectoryController");
const {
  getUserRequests,
  getUserRequestById,
  serveIdDocument,
  approveUserRequest,
  rejectUserRequest,
  getIdTypes,
} = require("../controllers/userRequestController");

const router = express.Router();

router.get("/id-types", getIdTypes);

router.get("/users", auth, roleCheck(["admin"]), getAllUsers);

router.get("/residents", auth, roleCheck(["bhw", "admin"]), getResidents);

router.patch("/users/:id/status", auth, roleCheck(["admin"]), updateUserStatus);

router.get("/admin/user-requests", auth, roleCheck(["admin"]), getUserRequests);
router.get("/admin/user-requests/:id", auth, roleCheck(["admin"]), getUserRequestById);
router.get("/admin/user-requests/:id/document", auth, roleCheck(["admin"]), serveIdDocument);
router.patch("/admin/user-requests/:id/approve", auth, roleCheck(["admin"]), approveUserRequest);
router.patch("/admin/user-requests/:id/reject", auth, roleCheck(["admin"]), rejectUserRequest);

module.exports = router;
