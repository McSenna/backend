"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const {
  getAllUsers,
  getUserSummary,
  getUserById,
  updateUserStatus,
} = require("../controllers/userController");
const { adminWriteLimiter, adminExportLimiter, adminResetLimiter } = require("../middleware/adminRateLimiter");
const { exportUsers } = require("../controllers/user/userExportController");
const { updateUser, updateUserRole, sendUserPasswordReset } = require("../controllers/user/userEditController");
const { getResidents } = require("../controllers/residentDirectoryController");
const { linkMasterRecord, unlinkMasterRecord } = require("../controllers/user/masterLinkController");
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
router.get("/users/summary", auth, roleCheck(["admin"]), getUserSummary);
router.get("/users/export", auth, roleCheck(["admin"]), adminExportLimiter, exportUsers);
router.get("/users/:id", auth, roleCheck(["admin"]), getUserById);

router.get("/residents", auth, roleCheck(["bhw", "admin"]), getResidents);

router.patch("/users/:id", auth, roleCheck(["admin"]), adminWriteLimiter, updateUser);
router.patch("/users/:id/role", auth, roleCheck(["admin"]), adminWriteLimiter, updateUserRole);
router.patch("/users/:id/status", auth, roleCheck(["admin"]), adminWriteLimiter, updateUserStatus);
router.post("/users/:id/password-reset", auth, roleCheck(["admin"]), adminResetLimiter, sendUserPasswordReset);
router.patch("/admin/users/:id/master-link", auth, roleCheck(["admin"]), linkMasterRecord);
router.post("/admin/users/:id/master-unlink", auth, roleCheck(["admin"]), unlinkMasterRecord);

router.get("/admin/user-requests", auth, roleCheck(["admin"]), getUserRequests);
router.get("/admin/user-requests/:id", auth, roleCheck(["admin"]), getUserRequestById);
router.get("/admin/user-requests/:id/document", auth, roleCheck(["admin"]), serveIdDocument);
router.patch("/admin/user-requests/:id/approve", auth, roleCheck(["admin"]), approveUserRequest);
router.patch("/admin/user-requests/:id/reject", auth, roleCheck(["admin"]), rejectUserRequest);

module.exports = router;
