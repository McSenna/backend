"use strict";

const {
  PLATFORMS,
  normalizePlatform,
  isPlatformAllowed,
} = require("../config/platformAccess");
const { forbidden } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

const CLIENT_PLATFORM_HEADER = "x-client-platform";

const BROWSER_SIGNAL_HEADERS = Object.freeze([
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "origin",
  "referer",
]);

const hasHeader = (req, name) => {
  const value = req?.headers?.[name];
  return typeof value === "string" && value.trim().length > 0;
};

function detectBrowserSignal(req) {
  return BROWSER_SIGNAL_HEADERS.find((header) => hasHeader(req, header)) || null;
}

function readClaimedPlatform(req) {
  return (
    normalizePlatform(req?.body?.clientPlatform) ||
    normalizePlatform(req?.query?.clientPlatform) ||
    normalizePlatform(req?.headers?.[CLIENT_PLATFORM_HEADER]) ||
    null
  );
}

function resolveRequestPlatform(req) {
  const claimed = readClaimedPlatform(req);
  const browserSignal = detectBrowserSignal(req);

  if (browserSignal) {
    return {
      platform: PLATFORMS.WEB,
      claimed,
      browserSignal,
      isBrowserRequest: true,
      source: "browser-signal",
    };
  }

  if (claimed) {
    return {
      platform: claimed,
      claimed,
      browserSignal: null,
      isBrowserRequest: false,
      source: "client-claim",
    };
  }

  return {
    platform: PLATFORMS.WEB,
    claimed: null,
    browserSignal: null,
    isBrowserRequest: false,
    source: "fallback",
  };
}

function getPlatformDenial(role, platform) {
  if (isPlatformAllowed(role, platform)) return null;

  if (String(role).toLowerCase() === "resident" && platform === PLATFORMS.WEB) {
    return {
      code: ERROR_CODES.RESIDENT_WEB_ACCESS_DENIED,
      message:
        "Resident accounts can only access MaslogCare through the mobile application.",
    };
  }

  return {
    code: ERROR_CODES.PLATFORM_ACCESS_DENIED,
    message: "This account is not authorized to access this platform.",
  };
}

function platformDenialError(role, platform) {
  const denial = getPlatformDenial(role, platform);
  if (!denial) return null;
  return forbidden(denial.message, denial.code);
}

module.exports = {
  CLIENT_PLATFORM_HEADER,
  BROWSER_SIGNAL_HEADERS,
  detectBrowserSignal,
  readClaimedPlatform,
  resolveRequestPlatform,
  getPlatformDenial,
  platformDenialError,
};
