"use strict";
const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");

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

const generatePasswordResetHTML = (fullname, resetUrl = "#") => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroOtp", `Reset Your Password`,
      `We received a request to reset your <strong style="color:${C.textDark};">MaslogCare</strong> password. Use the button below within 15 minutes.`),
    resetPasswordCardPartial(resetUrl),  
    resetSecurityNoticePartial(),        
    ignoreNoticePartial(),               
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Password Reset for ${firstName}</title>`)
    .replace(">Verification<", ">Security<");
};

module.exports = {
  generatePasswordResetHTML,
};