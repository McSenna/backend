"use strict";
const path = require("path");

const ASSETS = (() => {
  const base = path.resolve(__dirname, "..", "..", "assets");
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

const assetAttachment = (key) => ASSETS[key];

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

const cidImg = (key, width, height, alt = "", extraStyle = "") =>
  `<img src="cid:${ASSETS[key].cid}" width="${width}" height="${height}" alt="${alt}" border="0" style="display:block;${extraStyle}" />`;

module.exports = {
  ASSETS,
  assetAttachment,
  buildAttachments,
  cidImg,
};