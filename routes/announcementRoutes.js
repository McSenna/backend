"use strict";

const express = require("express");

const auth = require("../middleware/authMiddleware");
const roleCheck = require("../middleware/roleMiddleware");
const announcementController = require("../controllers/announcementController");

const router = express.Router();

const adminOnly = roleCheck("admin");

// Every signed-in account reads the same shared feed; only admins post to it.
router.get("/announcements", auth, announcementController.getAnnouncements);
router.get("/announcements/:id", auth, announcementController.getAnnouncementById);

router.get("/admin/announcements", auth, adminOnly, announcementController.getAdminAnnouncements);
router.post("/admin/announcements", auth, adminOnly, announcementController.createAnnouncement);
router.patch("/admin/announcements/:id", auth, adminOnly, announcementController.updateAnnouncement);
router.delete("/admin/announcements/:id", auth, adminOnly, announcementController.deleteAnnouncement);

module.exports = router;
