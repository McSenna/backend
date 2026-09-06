"use strict";

const express = require("express");

const auth = require("../middleware/authMiddleware");
const notificationController = require("../controllers/notificationController");

const router = express.Router();

router.get("/notifications", auth, notificationController.getNotifications);
router.patch("/notifications/:id/read", auth, notificationController.markNotificationRead);
router.patch("/notifications/read-all", auth, notificationController.markAllNotificationsRead);

module.exports = router;

