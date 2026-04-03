"use strict";
const { cidImg } = require("./assets");

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

const emailWrapper = (content, year) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title></title>
  ${fonts.link}
  <style>
    
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

const heroPartial = (iconKey, headline, description, buttonLabel = null) => `
<tr>
  <td style="padding:0;background:${C.pearl};">
    
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
    
  </td>
</tr>`;

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

module.exports = {
  C,
  fonts,
  emailWrapper,
  headerPartial,
  footerPartial,
  heroPartial,
  ignoreNoticePartial,
};