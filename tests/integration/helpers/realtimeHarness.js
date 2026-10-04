"use strict";

const jwt = require("jsonwebtoken");
const User = require("../../../models/User");

// Long enough for the 50ms change-feed batch plus a re-read on a slow machine.
const EVENT_TIMEOUT_MS = 3000;
const SILENCE_MS = 600;

let accountCount = 0;

/** Test-only accounts; every name and address here is invented. */
const createAccount = async (role) => {
  accountCount += 1;
  const user = await User.create({
    fullname: `Realtime ${role} ${accountCount}`,
    email: `realtime.${role}.${accountCount}@maslogcare.test`,
    password: "TestPassword123!",
    role,
    verified: true,
    status: role === "resident" ? "approved" : "active",
    phone: "09170000000",
    gender: "female",
    dateOfBirth: new Date("1990-01-15"),
    address: "Test address",
  });
  const token = jwt.sign({ userId: String(user._id), role, platform: "mobile" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  return { user, token };
};

/** Resolves with the event's first argument, or null if it never comes. */
const waitFor = (socket, event, timeoutMs = EVENT_TIMEOUT_MS) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve(null);
    }, timeoutMs);
    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, onEvent);
  });

const expectSilence = async (socket, event) => (await waitFor(socket, event, SILENCE_MS)) === null;

const nextConnect = (socket) =>
  new Promise((resolve) => {
    socket.once("connect", () => resolve({ connected: true }));
    socket.once("connect_error", (error) => resolve({ connected: false, error }));
  });

module.exports = { createAccount, waitFor, expectSilence, nextConnect };
