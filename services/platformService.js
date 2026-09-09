"use strict";

const {
  PLATFORMS,
  normalizePlatform,
  isPlatformAllowed,
} = require("../config/platformAccess");
const { forbidden } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");

/**
 * Decides which platform a request actually came from.
 *
 * The client sends a `clientPlatform` claim, but a claim on its own proves
 * nothing — anyone can post `clientPlatform: "mobile"` from a browser console
 * or from curl. So the claim is only ever the fallback; it is overruled first
 * by signals the browser itself controls.
 *
 * The corroborating signals are the Fetch Metadata headers (`Sec-Fetch-Mode`,
 * `Sec-Fetch-Site`, `Sec-Fetch-Dest`) and `Origin`. Those are forbidden header
 * names: page JavaScript cannot set, forge or strip them, and a browser
 * attaches them to every XHR/fetch it makes. React Native's networking stack
 * sends none of them, so their presence means "this request was made by a
 * browser" — that is, the web platform — no matter what the body claims. This
 * is deliberately not user-agent sniffing: a UA string is free text the caller
 * chooses, while these headers are written by the browser after the page has
 * had its say.
 *
 * A request with neither signals nor a valid claim resolves to `web`, the
 * platform with the stricter policy, so an unlabelled caller can never be
 * treated as the mobile app by omission.
 */

const CLIENT_PLATFORM_HEADER = "x-client-platform";

/**
 * Headers a browser attaches on its own. `referer` is last and weakest — a
 * non-browser client can send one — but by then the decision is already `web`,
 * which is the fail-closed answer anyway.
 */
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

/** The browser-written header that gave the request away, if any. */
function detectBrowserSignal(req) {
  return BROWSER_SIGNAL_HEADERS.find((header) => hasHeader(req, header)) || null;
}

/** What the caller says it is: body first (login), then header (every request). */
function readClaimedPlatform(req) {
  return (
    normalizePlatform(req?.body?.clientPlatform) ||
    normalizePlatform(req?.query?.clientPlatform) ||
    normalizePlatform(req?.headers?.[CLIENT_PLATFORM_HEADER]) ||
    null
  );
}

/**
 * @returns {{platform: string, claimed: string|null, browserSignal: string|null,
 *            isBrowserRequest: boolean, source: "browser-signal"|"client-claim"|"fallback"}}
 */
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

/**
 * The denial for a role/platform pair, or null when the pair is allowed.
 *
 * Residents get their own code and copy: "you are on the wrong client" is
 * actionable in a way that a flat permission error is not, and the web login
 * screen keys its Mobile App Required dialog off that code.
 */
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

/** The same denial as an AppError, for throw sites. */
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
