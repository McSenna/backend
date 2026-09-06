"use strict";

const User = require("../models/User");

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error("❌ Error in getAllUsers:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching users. Please try again later.",
    });
  }
};
