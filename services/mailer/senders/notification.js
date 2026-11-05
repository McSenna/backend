"use strict";
const logger = require("../../../utils/logger");
const { sendMail, hasCredentials, maskEmail } = require("../mailService");

const sendNotificationEmail = async (email, fullname = "User") => {
  if (!hasCredentials()) {
    logger.warn("Email settings missing; notification email not sent", { to: maskEmail(email) });
    return;
  }
  try {
    await sendMail({
      to: email,
      subject: "MaslogCare – Health Notification",
      text: [
        `Hello ${fullname},`,
        "",
        "You have received a new healthcare update from MaslogCare. Please log in to your patient portal to view your health records and updates.",
        "",
        "Questions? Email help@maslogcare.ph or visit your nearest Maslog Barangay Health Center.",
      ].join("\n"),
    });
  } catch {
    // sendMail has logged the failure, and this notice never fails the caller.
  }
};

module.exports = {
  sendNotificationEmail,
};
