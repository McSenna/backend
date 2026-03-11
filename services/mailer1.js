"use strict";
const nodemailer = require("nodemailer");

// ─── Transport ────────────────────────────────────────────────────────────────

const buildTransportConfig = () => {
  const user    = process.env.EMAIL_USER;
  const pass    = process.env.EMAIL_PASS;
  const port    = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 465;
  const isProd  = process.env.NODE_ENV === "production";

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

// ─── Pearl Design System ──────────────────────────────────────────────────────

const C = {
  pearl:        "#FFF7E6",
  pearlMid:     "#F5E4B8",
  pearlDeep:    "#F0D8A0",
  pearlBorder:  "#F0E2BC",
  pearlGold:    "#C49A3C",
  pearlGoldSoft:"#E8D890",
  midnight:     "#102E4A",
  midnightDeep: "#0A1E30",
  midnightMid:  "#1A4568",
  midnightLight:"#2D6B9E",
  skyBg:        "#E6F2FB",
  skyBorder:    "#B8D8F0",
  sageBg:       "#E8F6EE",
  sageBorder:   "#AADAC0",
  sageText:     "#1E5C38",
  goldBg:       "#FEF3DC",
  goldBorder:   "#F0D080",
  goldText:     "#8A6010",
  mist:         "#F4F7FA",
  mistBorder:   "#E0EAF2",
  white:        "#FFFFFF",
  bgOuter:      "#D6DDE4",
  textDark:     "#0E2038",
  textMid:      "#3A5068",
  textLight:    "#6A8A9E",
  textSubtle:   "#4A6E8A",
  textMuted:    "#8AAABB",
  red:          "#C0392B",
};

const fonts = {
  sans:  `'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
  serif: `'DM Serif Display', Georgia, 'Times New Roman', serif`,
  link:  `<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>`,
};

// ─── CID Asset Map ────────────────────────────────────────────────────────────
// Each icon is a physical PNG file embedded via Nodemailer's CID attachment system.
// The HTML references <img src="cid:..."> and each sendMail() call includes
// only the attachments needed by that template — no base64 blobs in the HTML source.
//
// Expected asset layout:
//   assets/
//     logo/
//       logo.png            (42×42)
//     icons/
//       hero-otp.png        (76×76)
//       hero-welcome.png    (76×76)
//       hero-notif.png      (76×76)
//       icon-calendar.png   (40×40)
//       icon-megaphone.png  (40×40)
//       icon-records.png    (40×40)
//       icon-health.png     (40×40)

const path = require("path");

// Maps each logical key → { cid, filename, filepath }
const ASSETS = (() => {
  const base = path.resolve(__dirname, "..", "assets");
  const icon = (filename, cid) => ({
    cid,
    filename,
    path: path.join(base, "icons", filename),
  });
  return {
    logo:        { cid: "maslogcareLogo",    filename: "logo.png",           path: path.join(base, "logo", "logo.png") },
    heroOtp:     icon("hero-otp.png",        "heroOtp"),
    heroWelcome: icon("hero-welcome.png",    "heroWelcome"),
    heroNotif:   icon("hero-notif.png",      "heroNotif"),
    calendar:    icon("icon-calendar.png",   "iconCalendar"),
    megaphone:   icon("icon-megaphone.png",  "iconMegaphone"),
    records:     icon("icon-records.png",    "iconRecords"),
    health:      icon("icon-health.png",     "iconHealth"),
  };
})();

// Build a Nodemailer attachment entry for a given asset key.
// Pass the result into the `attachments` array of sendMail().
const assetAttachment = (key) => ASSETS[key];

// Build the attachment list for a set of asset keys (deduplicates automatically).
const buildAttachments = (...keys) => {
  const seen = new Set();
  return keys.reduce((acc, key) => {
    if (!seen.has(key) && ASSETS[key]) {
      seen.add(key);
      acc.push(ASSETS[key]);
    }
    return acc;
  }, []);
};

// Produces an <img> tag that references the CID — works in Gmail, Outlook, Apple Mail, mobile.
const cidImg = (key, width, height, alt = "", extraStyle = "") =>
  `<img src="cid:${ASSETS[key].cid}" width="${width}" height="${height}" alt="${alt}" border="0" style="display:block;${extraStyle}" />`;

// ─── Shared Partials ──────────────────────────────────────────────────────────

const emailWrapper = (content, year) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title></title>
  ${fonts.link}
  <style>
    /* Mobile stack for 2x2 feature grid */
    @media only screen and (max-width:480px) {
      .feat-cell { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
      .feat-row  { display:block !important; width:100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${C.bgOuter};font-family:${fonts.sans};">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.bgOuter};padding:32px 16px;">
<tr><td align="center">
  <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="max-width:540px;width:100%;background:${C.white};border-radius:20px;overflow:hidden;box-shadow:0 2px 4px rgba(16,46,74,0.05),0 12px 40px rgba(16,46,74,0.14);">
    <tr><td>${headerPartial()}</td></tr>
    ${content}
    <tr><td>${footerPartial(year)}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

// ─── Header (PNG logo — no SVG) ───────────────────────────────────────────────
const headerPartial = () => `
<table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background:${C.pearl};border-bottom:1.5px solid ${C.pearlBorder};">
  <tr>
    <td style="padding:18px 32px;">
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"><tr>
        <td valign="middle">
          <table cellpadding="0" cellspacing="0" role="presentation"><tr>
            <td style="padding-right:11px; vertical-align:middle;">
              <div style="width:42px;height:42px;border-radius:50%;overflow:hidden;">
                ${cidImg("logo", 42, 42, "MaslogCare")}
              </div>
            </td>
            <td valign="middle">
              <div style="font-family:${fonts.serif};font-size:16px;color:${C.midnight};letter-spacing:-0.3px;line-height:1.1;">MaslogCare</div>
              <div style="font-size:9px;color:#6080A0;letter-spacing:1.8px;text-transform:uppercase;font-family:${fonts.sans};font-weight:700;margin-top:2px;">Community Health System</div>
            </td>
          </tr></table>
        </td>
        <td align="right" valign="middle">
          <span id="header-badge" style="font-size:10.5px;font-weight:600;color:${C.midnight};border:1.5px solid rgba(16,46,74,0.25);padding:5px 16px;border-radius:100px;font-family:${fonts.sans};">Verification</span>
        </td>
      </tr></table>
    </td>
  </tr>
</table>`.trim();

// Footer
const footerPartial = (year) => `
<table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background:${C.pearl};border-top:1.5px solid ${C.pearlBorder};">
  <tr>
    <td style="padding:22px 36px;">
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom:10px;"><tr>
        <td align="center">
          ${["How it works", "FAQs", "Privacy Policy", "Unsubscribe"].map((label, i, arr) => `
            <a href="#" style="font-size:11px;font-weight:600;color:${C.midnight};text-decoration:none;margin:0 8px;opacity:0.65;font-family:${fonts.sans};">${label}</a>
            ${i < arr.length - 1 ? `<span style="color:${C.pearlGold};font-size:11px;"> · </span>` : ""}
          `).join("")}
        </td>
      </tr></table>
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"><tr>
        <td align="center">
          <p style="margin:0;font-size:10.5px;color:#7A8A9A;font-family:${fonts.sans};line-height:1.72;">
            <strong style="color:${C.midnight};">MaslogCare Community Health System</strong><br/>
            Helping communities stay healthy through digital healthcare.<br/>
            <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};text-decoration:none;">help@maslogcare.ph</a>
            &nbsp;·&nbsp; &copy; ${year} Local Government of Maslog
          </p>
        </td>
      </tr></table>
    </td>
  </tr>
</table>`.trim();

// ─── Hero Partial (PNG icon — no SVG) ────────────────────────────────────────
const heroPartial = (iconKey, headline, description, buttonLabel = null) => `
<tr>
  <td style="padding:0;background:${C.pearl};">
    <!--[if mso]>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="center" style="background:#FFF7E6;padding:52px 40px 46px;">
    <![endif]-->
    <div style="background:linear-gradient(160deg,#FFFDF5 0%,#FFF7E6 40%,#F5E4B8 100%);padding:52px 40px 46px;text-align:center;">
      <div style="margin:0 auto 24px;display:inline-block;">
        ${cidImg(iconKey, 76, 76, headline, "margin:0 auto;")}
      </div>
      <h1 style="margin:0 0 12px;font-family:${fonts.serif};font-size:30px;color:${C.textDark};letter-spacing:-0.4px;line-height:1.2;">${headline}</h1>
      <p style="margin:0 auto;font-size:13.5px;color:${C.textMid};line-height:1.75;max-width:340px;">${description}</p>
      ${buttonLabel ? `
      <div style="margin-top:26px;">
        <a href="#" style="display:inline-block;background:${C.midnight};color:${C.white};font-family:${fonts.sans};font-size:13px;font-weight:700;padding:13px 32px;border-radius:100px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(16,46,74,0.32);">${buttonLabel}</a>
      </div>` : ""}
    </div>
    <!--[if mso]></td></tr></table><![endif]-->
  </td>
</tr>`;

// ─── OTP Template ─────────────────────────────────────────────────────────────
// REFERENCE SIZE — all other emails match this exact body structure:
//   Section A: mist bg, padding 28px 26px 20px  → main content card(s)
//   Section B: white bg, padding 20px 26px 24px → closing note / CTA row

const otpDigitBoxes = (otp) =>
  String(otp).split("").map(d => `
    <td style="padding:0 5px;">
      <div style="width:58px;height:68px;line-height:68px;background:#F4F8FC;border:2px solid #C8DCEA;border-bottom:5px solid ${C.midnight};border-radius:14px;font-family:${fonts.serif};font-size:30px;color:${C.midnight};text-align:center;box-shadow:0 3px 10px rgba(16,46,74,0.10);">${d}</div>
    </td>`).join("");

// Section A — OTP card
const otpCardPartial = (otp) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">One-Time Password</p>
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.05);"><tr>
      <td style="padding:28px 20px;text-align:center;">
        <p style="margin:0 0 20px;font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Your Verification Code</p>
        <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 14px;">
          <tr>${otpDigitBoxes(otp)}</tr>
        </table>
        <p style="margin:0;font-size:12px;font-weight:600;color:${C.red};font-family:${fonts.sans};">
          &#9201; Expires in 5 minutes &nbsp;&middot;&nbsp; Do not share this code
        </p>
      </td>
    </tr></table>

    <!-- Security notice sits inside the same mist section, same as OTP -->
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-top:10px;background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;">
          <table cellpadding="0" cellspacing="0" role="presentation"><tr>
            <td valign="top" style="padding-right:14px;">
              <div style="width:36px;height:36px;background:${C.mist};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#128274;</div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

// Section C — shared footnote row for ALL emails (white bg, padding:28px 36px)
const ignoreNoticePartial = () => `
<tr>
  <td style="background:${C.white};padding:28px 36px;text-align:center;border-top:1px solid #EAF0F6;">
    <p style="margin:0;font-size:12px;color:${C.textMuted};line-height:1.72;font-family:${fonts.sans};">
      Questions or concerns? Contact us at
      <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">help@maslogcare.ph</a>
      or visit your nearest Maslog Barangay Health Center.
    </p>
  </td>
</tr>`;

// Section B for OTP — left-border lock notice (padding:0 26px 20px)
const securityNoticePartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.mist};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#128274;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Security Notice</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              MaslogCare staff will <strong>never</strong> ask for this code by phone, SMS, or chat.
              If someone requests it, please <strong>refuse and report</strong> to
              <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">help@maslogcare.ph</a>.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

// ─── Welcome Template ─────────────────────────────────────────────────────────
// Matches OTP structure: Section A (mist, 2×2 grid) + Section B (white, CTA+support)
// Grid uses fixed pixel widths only — NO CSS classes, NO @media queries.
// Gmail strips <style> blocks on mobile, so percentage widths collapse to 1 column.
// Fixed 236px per card = (488px inner width − 16px gap) ÷ 2.

const WELCOME_FEATURES = [
  { iconKey: "calendar",  title: "Book Appointments",    desc: "Schedule barangay health visits easily" },
  { iconKey: "megaphone", title: "Health Announcements", desc: "Stay updated on programs & alerts"       },
  { iconKey: "records",   title: "Medical Records",      desc: "View & manage your health history"       },
  { iconKey: "health",    title: "Health Programs",      desc: "Access community wellness programs"      },
];

const featureCard = ({ iconKey, title, desc }) => `
<table cellpadding="0" cellspacing="0" width="236" role="presentation"
  style="width:236px;background:${C.white};border:1px solid ${C.mistBorder};border-top:3px solid ${C.midnight};border-radius:12px;box-shadow:0 2px 8px rgba(16,46,74,0.06);">
  <tr>
    <td width="236" style="padding:16px 10px;text-align:center;">
      <div style="margin:0 auto 9px;width:42px;height:42px;background:${C.mist};border-radius:10px;text-align:center;line-height:42px;">
        ${cidImg(iconKey, 38, 38, title, "margin:0 auto;")}
      </div>
      <p style="margin:0 0 3px;font-size:11px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};line-height:1.3;">${title}</p>
      <p style="margin:0;font-size:10px;color:${C.textLight};line-height:1.45;font-family:${fonts.sans};">${desc}</p>
    </td>
  </tr>
</table>`;

// Section A — Welcome: 2×2 grid (padding:28px 26px 20px matches otpCardPartial outer)
// Fixed-pixel widths only — NO CSS classes, NO @media (Gmail strips style blocks on mobile)
// Card width = (488px inner − 12px gap) / 2 = 238px
const welcomeGridPartial = () => {
  const [f1, f2, f3, f4] = WELCOME_FEATURES;
  return `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};text-align:center;">What You Can Do</p>
    <table cellpadding="0" cellspacing="0" width="488" role="presentation" style="width:488px;">
      <tr>
        <td width="238" valign="top" style="width:238px;padding-bottom:8px;">${featureCard(f1)}</td>
        <td width="12"  style="width:12px;"></td>
        <td width="238" valign="top" style="width:238px;padding-bottom:8px;">${featureCard(f2)}</td>
      </tr>
      <tr>
        <td width="238" valign="top" style="width:238px;">${featureCard(f3)}</td>
        <td width="12"  style="width:12px;"></td>
        <td width="238" valign="top" style="width:238px;">${featureCard(f4)}</td>
      </tr>
    </table>
  </td>
</tr>`;
};

// Section B — Welcome notice (padding:0 26px 20px matches securityNoticePartial)
const welcomeCtaPartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.sageBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#9989;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">You&rsquo;re all set!</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Access your dashboard to book appointments and view health records.
              Questions? Email <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">help@maslogcare.ph</a>.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

// ─── Notification Template ────────────────────────────────────────────────────
// Section A: 2 notification cards inside mist section
// Section B: white closing row with CTA button

const NOTIFICATION_CARDS = [
  {
    emoji: "&#128197;", iconBg: C.skyBg,  iconBorder: C.skyBorder,
    title: "Appointment Reminder",
    desc:  "Your health center appointment is scheduled for tomorrow at 9:00 AM. Please bring your health booklet and valid ID.",
    tag: "&#128205; Tomorrow, 9:00 AM", tagBg: C.skyBg, tagBorder: C.skyBorder, tagColor: C.midnight,
  },
  {
    emoji: "&#128137;", iconBg: C.sageBg, iconBorder: C.sageBorder,
    title: "Vaccination Program",
    desc:  "Free flu vaccination available this week at the Barangay Health Center. Walk-ins welcome — no appointment needed.",
    tag: "&#128197; Until Mar 31", tagBg: C.sageBg, tagBorder: C.sageBorder, tagColor: C.sageText,
  },
  {
    emoji: "&#127775;", iconBg: C.goldBg, iconBorder: C.goldBorder,
    title: "Community Announcement",
    desc:  "New telehealth consultation services are now available for all registered MaslogCare members in the barangay.",
    tag: "&#10024; New Service", tagBg: C.goldBg, tagBorder: C.goldBorder, tagColor: C.goldText,
  },
];

// Section A — Notification: 2 compact cards inside one white card (matches otpCardPartial height)
const notificationBodyPartial = () => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Your Updates</p>
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.05);">
      ${NOTIFICATION_CARDS.slice(0,2).map((card, i) => `
      <tr><td style="padding:16px 18px;${i > 0 ? `border-top:1px solid ${C.mistBorder};` : ""}">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:12px;">
            <div style="width:40px;height:40px;background:${card.iconBg};border:1.5px solid ${card.iconBorder};border-radius:10px;text-align:center;line-height:40px;font-size:19px;">${card.emoji}</div>
          </td>
          <td valign="top">
            <p style="margin:0 0 3px;font-size:12.5px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">${card.title}</p>
            <p style="margin:0 0 6px;font-size:11.5px;color:${C.textLight};line-height:1.55;font-family:${fonts.sans};">${card.desc}</p>
            <span style="display:inline-block;font-size:10px;font-weight:700;color:${card.tagColor};background:${card.tagBg};border:1px solid ${card.tagBorder};padding:2px 9px;border-radius:100px;font-family:${fonts.sans};">${card.tag}</span>
          </td>
        </tr></table>
      </td></tr>`).join("")}
      <tr><td style="padding:12px 18px;border-top:1px solid ${C.mistBorder};text-align:center;">
        <a href="#" style="display:inline-block;background:${C.midnight};color:${C.white};font-family:${fonts.sans};font-size:12px;font-weight:700;padding:10px 28px;border-radius:100px;text-decoration:none;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(16,46,74,0.26);">View Health Portal &#8594;</a>
      </td></tr>
    </table>
  </td>
</tr>`;

// Section B — Notification notice (matches securityNoticePartial pattern: padding:0 26px 20px)
const notificationCtaPartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.skyBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#128276;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Stay Up to Date</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Log in to your patient portal to view complete health records, manage appointments, and access all services.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

// ─── Appointment Templates ────────────────────────────────────────────────────
// Section A: mist, padding:28px 26px 20px  (matches otpCardPartial outer padding)
// Section B: mist, padding:0 26px 20px     (matches securityNoticePartial outer padding)
// Section C: white, padding:28px 36px      (matches ignoreNoticePartial)

const appointmentDetailsCard = ({ patientName, date, time, worker, location }) => `
<table cellpadding="0" cellspacing="0" width="100%" role="presentation"
  style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.06);">
  <tr>
    <td style="padding:20px 20px 6px;">
      ${[
        { label: "&#128100; Patient",       value: patientName },
        { label: "&#128197; Date",           value: date        },
        { label: "&#128336; Time",           value: time        },
        { label: "&#129654; Health Worker",  value: worker      },
        { label: "&#127968; Location",       value: location    },
      ].map(({ label, value }) => `
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation" style="margin-bottom:12px;">
        <tr>
          <td width="130" valign="top">
            <span style="font-size:11px;font-weight:700;color:${C.textSubtle};font-family:${fonts.sans};">${label}</span>
          </td>
          <td valign="top">
            <span style="font-size:12.5px;font-weight:600;color:${C.textDark};font-family:${fonts.sans};">${value}</span>
          </td>
        </tr>
      </table>`).join("")}
    </td>
  </tr>
  <tr>
    <td style="padding:0 20px 18px;">
      <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
        style="background:${C.sageBg};border:1px solid ${C.sageBorder};border-radius:10px;">
        <tr>
          <td style="padding:10px 16px;text-align:center;">
            <span style="font-size:12px;font-weight:700;color:${C.sageText};font-family:${fonts.sans};">&#9989; Your appointment is confirmed</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

// Section A — Appointment Confirmation
const appointmentInfoCard = ({ patientName, date, time, worker, location }) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Appointment Details</p>
    ${appointmentDetailsCard({ patientName, date, time, worker, location })}
  </td>
</tr>`;

// Section B — Appointment Confirmation (matches securityNoticePartial: padding:0 26px 20px)
const appointmentReminderRow = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.midnight};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.skyBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#128276;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Before You Come</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Arrive <strong>10 minutes early</strong> and bring your health booklet and a valid ID.
              Need changes? Email <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">help@maslogcare.ph</a>.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

// Section A — Appointment Reminder (urgency banner inside Section A mist)
const appointmentReminderCard = ({ patientName, date, time, worker, location }) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.goldBg};border:1.5px solid ${C.goldBorder};border-radius:10px;margin-bottom:14px;">
      <tr>
        <td style="padding:10px 16px;text-align:center;">
          <span style="font-size:12px;font-weight:700;color:${C.goldText};font-family:${fonts.sans};">&#9200; Your appointment is tomorrow</span>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 14px;font-size:10px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${C.textSubtle};font-family:${fonts.sans};">Appointment Details</p>
    ${appointmentDetailsCard({ patientName, date, time, worker, location })}
  </td>
</tr>`;

// Section B — Appointment Reminder (matches securityNoticePartial: padding:0 26px 20px)
const rescheduleRowPartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.goldBorder};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:${C.goldBg};border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#9200;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:${C.goldText};font-family:${fonts.sans};">Can&rsquo;t make it?</p>
            <table cellpadding="0" cellspacing="0" role="presentation"><tr>
              <td style="padding-right:8px;">
                <a href="#" style="display:inline-block;background:${C.midnight};color:${C.white};font-family:${fonts.sans};font-size:11.5px;font-weight:700;padding:8px 18px;border-radius:50px;text-decoration:none;">Confirm Attendance</a>
              </td>
              <td>
                <a href="mailto:help@maslogcare.ph" style="display:inline-block;border:1.5px solid ${C.midnight};color:${C.midnight};font-size:11.5px;font-weight:700;font-family:${fonts.sans};text-decoration:none;padding:7px 16px;border-radius:50px;">Request Reschedule</a>
              </td>
            </tr></table>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

// ─── Password Reset Template ──────────────────────────────────────────────────
// Section A: reset card  (padding:28px 26px 20px)
// Section B: security notice (padding:0 26px 20px)
// Section C: footnote (padding:28px 36px)

const resetPasswordCardPartial = (resetUrl) => `
<tr>
  <td style="background:${C.mist};padding:28px 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-radius:14px;box-shadow:0 2px 10px rgba(16,46,74,0.05);">
      <tr><td style="padding:28px 20px;text-align:center;">
        <div style="margin:0 auto 16px;width:52px;height:52px;background:${C.mist};border-radius:13px;text-align:center;line-height:52px;font-size:24px;">&#128273;</div>
        <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Reset Your Password</p>
        <p style="margin:0 0 20px;font-size:12px;color:${C.textMid};line-height:1.7;font-family:${fonts.sans};">
          Click below to set a new password. Valid for <strong style="color:${C.textDark};">15 minutes</strong>.
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:${C.midnight};color:${C.white};font-family:${fonts.sans};font-size:13px;font-weight:700;padding:13px 34px;border-radius:100px;text-decoration:none;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(16,46,74,0.30);">Reset Password &#8594;</a>
        <p style="margin:14px 0 0;font-size:10.5px;color:${C.textMuted};font-family:${fonts.sans};">
          Or copy: <span style="color:${C.midnightLight};word-break:break-all;">${resetUrl}</span>
        </p>
      </td></tr>
    </table>
  </td>
</tr>`;

const resetSecurityNoticePartial = () => `
<tr>
  <td style="background:${C.mist};padding:0 26px 20px;">
    <table cellpadding="0" cellspacing="0" width="100%" role="presentation"
      style="background:${C.white};border:1px solid ${C.mistBorder};border-left:4px solid ${C.red};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table cellpadding="0" cellspacing="0" role="presentation"><tr>
          <td valign="top" style="padding-right:14px;">
            <div style="width:36px;height:36px;background:#FEF0EE;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">&#9888;&#65039;</div>
          </td>
          <td valign="middle">
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${C.textDark};font-family:${fonts.sans};">Didn&rsquo;t request this?</p>
            <p style="margin:0;font-size:12px;color:${C.textMid};line-height:1.68;font-family:${fonts.sans};">
              Your password stays unchanged. Ignore this email or
              <a href="mailto:help@maslogcare.ph" style="color:${C.midnight};font-weight:700;text-decoration:none;">report unauthorized access</a>.
            </p>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr>`;

// ─── Template Generators ──────────────────────────────────────────────────────
// Every email = hero + Section A + Section B + Section C
// Identical padding pattern to OTP — all emails are the same height.

const generateOTPEmailHTML = (fullname, otp) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroOtp", `Verify Your Identity`,
      `Enter your one-time code below to confirm secure access to MaslogCare. This code is valid for <strong style="color:${C.textDark};">5 minutes</strong> only.`),
    otpCardPartial(otp),           // Section A — mist, padding:28px 26px 20px
    securityNoticePartial(),       // Section B — mist, padding:0 26px 20px
    ignoreNoticePartial(),         // Section C — white, padding:28px 36px
  ].join("\n");
  return emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Verify Your Identity, ${firstName}</title>`);
};

const generateNotificationEmailHTML = (fullname) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Health Notification`,
      `You have received a new healthcare update from MaslogCare. Please review the details below at your convenience.`),
    notificationBodyPartial(),     // Section A
    notificationCtaPartial(),     // Section B
    ignoreNoticePartial(),        // Section C
  ].join("\n");
  return emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Health Notification for ${firstName}</title>`)
    .replace(">Verification<", ">Notification<");
};

const generateWelcomeEmailHTML = (fullname) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroWelcome", `Welcome, ${firstName}`,
      `Your <strong style="color:${C.textDark};">MaslogCare</strong> account is verified and ready. You now have full access to the Barangay Healthcare System.`),
    welcomeGridPartial(),          // Section A
    welcomeCtaPartial(),          // Section B
    ignoreNoticePartial(),        // Section C
  ].join("\n");
  return emailWrapper(body, year)
    .replace("<title></title>", `<title>Welcome to MaslogCare, ${firstName}</title>`)
    .replace(">Verification<", ">Welcome<");
};

const generateAppointmentConfirmationHTML = (fullname, { date, time, worker, location }) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Appointment Confirmed`,
      `Your appointment at <strong style="color:${C.textDark};">MaslogCare</strong> has been successfully scheduled. Please review the details below.`),
    appointmentInfoCard({ patientName: fullname, date, time, worker, location }),  // Section A
    appointmentReminderRow(),     // Section B
    ignoreNoticePartial(),        // Section C
  ].join("\n");
  return emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Confirmed for ${firstName}</title>`)
    .replace(">Verification<", ">Appointment<");
};

const generateAppointmentReminderHTML = (fullname, { date, time, worker, location }) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroNotif", `Upcoming Appointment`,
      `This is a reminder of your upcoming appointment at <strong style="color:${C.textDark};">MaslogCare</strong>. We look forward to seeing you.`),
    appointmentReminderCard({ patientName: fullname, date, time, worker, location }),  // Section A
    rescheduleRowPartial(),       // Section B
    ignoreNoticePartial(),        // Section C
  ].join("\n");
  return emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Appointment Reminder for ${firstName}</title>`)
    .replace(">Verification<", ">Reminder<");
};

const generatePasswordResetHTML = (fullname, resetUrl = "#") => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroOtp", `Reset Your Password`,
      `We received a request to reset your <strong style="color:${C.textDark};">MaslogCare</strong> password. Use the button below within 15 minutes.`),
    resetPasswordCardPartial(resetUrl),  // Section A
    resetSecurityNoticePartial(),        // Section B
    ignoreNoticePartial(),               // Section C
  ].join("\n");
  return emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Password Reset for ${firstName}</title>`)
    .replace(">Verification<", ">Security<");
};



const hasCredentials = () => !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const sendOTPEmail = async (email, otp, fullname = "User") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. OTP would be sent to:", email, "code:", otp);
    return;
  }
  try {
    const info = await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Your Verification Code",
      html:        generateOTPEmailHTML(fullname, otp),
      text:        `Your MaslogCare verification code is: ${otp}\n\nExpires in 5 minutes. Do not share this code.\nIf you did not request this, please ignore this message.`,
      attachments: buildAttachments("logo", "heroOtp"),
    });
    console.log("✅ OTP email sent:", info.response);
    return info;
  } catch (err) {
    console.error("❌ Error sending OTP email:", err);
    throw new Error(`Failed to send verification email: ${err.message}`);
  }
};

const sendNotificationEmail = async (email, fullname = "User") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send notification email to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Health Notification",
      html:        generateNotificationEmailHTML(fullname),
      text:        `You have received a new healthcare update from MaslogCare. Please log in to your patient portal to view your health records and updates.\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Notification email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending notification email:", err);
  }
};

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

const sendAppointmentConfirmationEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment confirmation to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Your Appointment is Confirmed",
      html:        generateAppointmentConfirmationHTML(fullname, appointmentDetails),
      text:        `Hello ${fullname}, your MaslogCare appointment has been confirmed.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nHealth Worker: ${appointmentDetails.worker}\nLocation: ${appointmentDetails.location}\n\nQuestions? Email help@maslogcare.ph or visit the health center.`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment confirmation email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment confirmation email:", err);
    throw new Error(`Failed to send appointment confirmation email: ${err.message}`);
  }
};

const sendAppointmentReminderEmail = async (email, fullname = "User", appointmentDetails = {}) => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send appointment reminder to:", email);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Reminder: Appointment Tomorrow",
      html:        generateAppointmentReminderHTML(fullname, appointmentDetails),
      text:        `Hello ${fullname}, this is a reminder of your upcoming MaslogCare appointment.\n\nDate: ${appointmentDetails.date}\nTime: ${appointmentDetails.time}\nHealth Worker: ${appointmentDetails.worker}\nLocation: ${appointmentDetails.location}\n\nPlease arrive 10 minutes early and bring your health booklet and valid ID.\nQuestions? Email help@maslogcare.ph`,
      attachments: buildAttachments("logo", "heroNotif"),
    });
    console.log("✅ Appointment reminder email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending appointment reminder email:", err);
    throw new Error(`Failed to send appointment reminder email: ${err.message}`);
  }
};

const sendPasswordResetEmail = async (email, fullname = "User", resetUrl = "#") => {
  if (!hasCredentials()) {
    console.warn("⚠️  Email credentials not configured. Would send password reset to:", email, "url:", resetUrl);
    return;
  }
  try {
    await transporter.sendMail({
      from:        `"MaslogCare" <${process.env.EMAIL_USER}>`,
      to:          email,
      subject:     "MaslogCare – Password Reset Request",
      html:        generatePasswordResetHTML(fullname, resetUrl),
      text:        `Hello ${fullname},\n\nYou requested a password reset for your MaslogCare account.\n\nReset link (valid for 15 minutes):\n${resetUrl}\n\nIf you did not request this, please ignore this email or contact help@maslogcare.ph.`,
      attachments: buildAttachments("logo", "heroOtp"),
    });
    console.log("✅ Password reset email sent to:", email);
  } catch (err) {
    console.error("❌ Error sending password reset email:", err);
    throw new Error(`Failed to send password reset email: ${err.message}`);
  }
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  transporter,
  // CID asset helpers (useful for testing or custom send flows)
  ASSETS,
  buildAttachments,
  // HTML generators
  generateOTPEmailHTML,
  generateNotificationEmailHTML,
  generateWelcomeEmailHTML,
  generateAppointmentConfirmationHTML,
  generateAppointmentReminderHTML,
  generatePasswordResetHTML,
  // Send functions
  sendOTPEmail,
  sendNotificationEmail,
  sendWelcomeEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentReminderEmail,
  sendPasswordResetEmail,
};