"use strict";
const logger = require("../../../utils/logger");
const { sendMail, hasCredentials, maskEmail } = require("../mailService");

const sendWelcomeEmail = async (email, fullname = "User") => {
  if (!hasCredentials()) {
    logger.warn("Email settings missing; welcome email not sent", { to: maskEmail(email) });
    return;
  }
  try {
    await sendMail({
      to: email,
      subject: "Welcome to MaslogCare – Account Activated",
      text: [
        `Welcome to MaslogCare, ${fullname}.`,
        "",
        "Your account is verified and ready. You now have full access to the Barangay Healthcare System.",
        "",
        "What you can do:",
        "- Book barangay health visits",
        "- Stay updated on health programs and alerts",
        "- View and manage your health history",
        "- Access community wellness programs",
        "",
        "Questions? Email help@maslogcare.ph or visit your nearest Maslog Barangay Health Center.",
      ].join("\n"),
    });
  } catch {
    // sendMail has logged the failure, and a welcome note never fails the caller.
  }
};

module.exports = {
  sendWelcomeEmail,
};
