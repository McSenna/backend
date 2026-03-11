"use strict";
const { transporter, hasCredentials } = require("../config");
const { generateWelcomeEmailHTML } = require("../templates/welcome");
const { buildAttachments } = require("../assets");

const sendWelcomeEmail = async (email, fullname = "User") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send welcome email to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "Welcome to MaslogCare – Account Activated",
      html:        generateWelcomeEmailHTML(fullname),
      text:        `Welcome to MaslogCare, ${fullname}! Your account has been successfully created and verified.\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroWelcome", "calendar", "megaphone", "records", "health"),
    });
    console.log("✅ Welcome email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending welcome email:", err);
  }
};

module.exports = {
  sendWelcomeEmail,
};