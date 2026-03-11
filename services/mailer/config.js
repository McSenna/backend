"use strict";
const nodemailer = require("nodemailer");

const buildTransportConfig = () => {
  const user   = process.env.EMAIL_USER;
  const pass   = process.env.EMAIL_PASS;
  const port   = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 465;
  const isProd = process.env.NODE_ENV === "production";

  const config = {
    host:   process.env.EMAIL_HOST || "smtp.gmail.com",
    port,
    secure: process.env.EMAIL_SECURE !== undefined
      ? process.env.EMAIL_SECURE === "true"
      : port === 465,
    auth: user && pass ? { user, pass } : undefined,
  };

  if (port === 587) {
    config.secure     = false;
    config.requireTLS = true;
  }

  if (!isProd) {
    const rejectUnauthorized = process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true";
    config.tls = { rejectUnauthorized };
    if (!rejectUnauthorized) {
      console.warn("⚠️  Email TLS: certificate verification is OFF (dev default). Set EMAIL_TLS_REJECT_UNAUTHORIZED=true to enforce it.");
    }
  }

  return config;
};

const transporter = nodemailer.createTransport(buildTransportConfig());

const verifyTransport = () => {
  const { EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS) return;

  transporter.verify((err, ok) => {
    if (ok) return console.log("✅ Email service is ready");

    console.warn("⚠️  Email service verification failed:", err.message);

    if (err.code === "ECONNREFUSED") {
      console.warn("ℹ️  Gmail SMTP connection refused. Ensure:\n   • EMAIL_HOST=smtp.gmail.com and EMAIL_PORT=465 or 587\n   • Use an App Password (not your normal password) if 2FA is on\n   • No firewall/proxy blocking outbound SMTP; try EMAIL_PORT=587 if 465 fails");
    } else if (/self-signed certificate/i.test(err.message) || err.code === "ESOCKET") {
      console.warn("ℹ️  TLS issue. For local dev behind a proxy set EMAIL_TLS_REJECT_UNAUTHORIZED=false. In production use valid certificates.");
    }
  });
};

verifyTransport();

const hasCredentials = () => !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

module.exports = {
  transporter,
  hasCredentials,
};