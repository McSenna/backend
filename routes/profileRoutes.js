"use strict";

const express = require("express");
const auth = require("../middleware/authMiddleware");
const { getMyProfile, updateMyProfile } = require("../controllers/profileController");

const router = express.Router();

router.get("/profile", auth, getMyProfile);
router.patch("/profile", auth, updateMyProfile);

module.exports = router;
