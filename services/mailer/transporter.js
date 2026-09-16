"use strict";

const nodemailer = require("nodemailer");
const { EmailServiceError, EmailErrorCode } = require("./errors");

const getMailConfig = () => {
  const isProd = process.env.NODE_ENV === "production";
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS;
  const port = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 465;
  const host = process.env.EMAIL_HOST || "smtp.gmail.com";
  const enabled = process.env.EMAIL_ENABLED !== "false";
  const provider = (process.env.EMAIL_PROVIDER || "smtp").toLowerCase();

  const secure =
    process.env.EMAIL_SECURE !== undefined
      ? process.env.EMAIL_SECURE === "true"
      : port === 465;

  const fromAddress = process.env.EMAIL_FROM || user || "noreply@maslogcare.ph";
  const fromName = process.env.EMAIL_FROM_NAME || "MaslogCare";

  return {
    isProd,
    enabled,
    provider,
    host,
    port,
    secure,
    user,
    pass,
    fromAddress,
    fromName,
    formattedFrom: `"${fromName}" <${fromAddress}>`,
  };
};

const hasCredentials = () => {
  const config = getMailConfig();
  return Boolean(config.user && config.pass);
};

const isEmailEnabled = () => {
  const config = getMailConfig();
  return config.enabled;
};

const createCentralTransporter = () => {
  const config = getMailConfig();

  if (!config.enabled || config.provider === "mock") {
    console.log("ℹ️  [MAIL] Mock email transport initialized (EMAIL_ENABLED=false or provider=mock).");
    return {
      isMock: true,
      sendMail: async (mailOptions) => {
        const masked = maskEmail(mailOptions.to);
        console.log(`[MAIL MOCK] Intercepted email to ${masked}. Subject: "${mailOptions.subject}"`);
        return {
          messageId: `mock-${Date.now()}@maslogcare.local`,
          response: "250 Mock email accepted (no SMTP connection used)",
        };
      },
      verify: (cb) => {
        if (cb) cb(null, true);
        return Promise.resolve(true);
      },
    };
  }

  const transportOpts = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
  };

  if (config.port === 587) {
    transportOpts.secure = false;
    transportOpts.requireTLS = true;
  }

  if (!config.isProd) {
    const rejectUnauthorized = process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true";
    transportOpts.tls = { rejectUnauthorized };
    if (!rejectUnauthorized) {
      console.warn("⚠️  [MAIL] TLS certificate verification is OFF for development. Set EMAIL_TLS_REJECT_UNAUTHORIZED=true in production.");
    }
  }

  return nodemailer.createTransport(transportOpts);
};

const transporter = createCentralTransporter();

function maskEmail(email) {
  if (!email || typeof email !== "string") return "unknown";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

const verifyTransport = () => {
  const config = getMailConfig();

  if (!config.enabled || config.provider === "mock") {
    console.log("✅ [MAIL] Development mock email mode active — no external SMTP quota will be consumed.");
    return;
  }

  if (!config.user || !config.pass) {
    console.warn("⚠️  [MAIL] EMAIL_USER or EMAIL_PASSWORD/EMAIL_PASS is missing in .env. Outgoing emails will fail until configured.");
    return;
  }

  transporter.verify((err, ok) => {
    if (ok) {
      console.log(`✅ [MAIL] SMTP connection verified (${config.host}:${config.port}) — ready to send (subject to provider daily sending quota)`);
      return;
    }

    console.warn("⚠️  [MAIL] SMTP connection verification failed:", err?.message);

    if (err?.code === "ECONNREFUSED") {
      console.warn("ℹ️  [MAIL] Connection refused. Check EMAIL_HOST and EMAIL_PORT (try 587 instead of 465 if blocked).");
    } else if (err?.responseCode === 535 || /authentication/i.test(err?.message)) {
      console.warn("ℹ️  [MAIL] Authentication rejected. If using Gmail, make sure you use an App Password (16 characters) instead of account password.");
    } else if (/self-signed certificate/i.test(err?.message) || err?.code === "ESOCKET") {
      console.warn("ℹ️  [MAIL] TLS issue. Set EMAIL_TLS_REJECT_UNAUTHORIZED=false in dev if behind a corporate proxy.");
    }
  });
};

module.exports = {
  transporter,
  getMailConfig,
  hasCredentials,
  isEmailEnabled,
  verifyTransport,
  maskEmail,
};
