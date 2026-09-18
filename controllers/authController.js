"use strict";

const { register } = require("./auth/registerController");
const { sendOtp, verifyOtp } = require("./auth/otpController");
const { login, logout } = require("./auth/sessionController");
const { changePassword } = require("./auth/changePasswordController");

module.exports = { register, sendOtp, verifyOtp, login, logout, changePassword };
