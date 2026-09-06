"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const { getAllUsers } = require("../controllers/userController");

const router = express.Router();

// Only admins can list all users.
router.get("/users", auth, roleCheck(["admin"]), getAllUsers);

module.exports = router;
