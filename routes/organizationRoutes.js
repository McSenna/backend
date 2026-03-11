const express = require("express");
const router = express.Router();
const Organization = require("../models/organization");

router.get("/organizations", async (req, res) => {
  try {
    const org = await Organization.find();
    res.json(org);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;