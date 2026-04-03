"use strict";
const { C, fonts, heroPartial, ignoreNoticePartial } = require("../utils");

const otpDigitBoxes = (otp) =>
  String(otp).split("").map(d => `
    <td style="padding:0 5px;">
      <div style="width:58px;height:68px;line-height:68px;background:#F4F8FC;border:2px solid #C8DCEA;border-bottom:5px solid ${C.midnight};border-radius:14px;font-family:${fonts.serif};font-size:30px;color:${C.midnight};text-align:center;box-shadow:0 3px 10px rgba(16,46,74,0.10);">${d}</div>
    </td>`).join("");

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
    </tr>
    </table>
</tr>`;

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

const generateOTPEmailHTML = (fullname, otp) => {
  const year      = new Date().getFullYear();
  const firstName = String(fullname).split(" ")[0];
  const body = [
    heroPartial("heroOtp", `Verify Your Identity`,
      `Enter your one-time code below to confirm secure access to MaslogCare. This code is valid for <strong style="color:${C.textDark};">5 minutes</strong> only.`),
    otpCardPartial(otp),           
    securityNoticePartial(),       
    ignoreNoticePartial(),         
  ].join("\n");
  return require("../utils").emailWrapper(body, year)
    .replace("<title></title>", `<title>MaslogCare – Verify Your Identity, ${firstName}</title>`);
};

module.exports = {
  generateOTPEmailHTML,
};