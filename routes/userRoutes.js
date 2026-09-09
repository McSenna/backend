"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const { getAllUsers, updateUserStatus } = require("../controllers/userController");

const router = express.Router();

// Only admins can list all users.
router.get("/users", auth, roleCheck(["admin"]), getAllUsers);

// Account standing is an administrative action; the controller additionally
// refuses to let an admin disable their own account.
router.patch("/users/:id/status", auth, roleCheck(["admin"]), updateUserStatus);

module.exports = router;
