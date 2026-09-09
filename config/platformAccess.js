"use strict";

/**
 * The single source of truth for which client platform each role may use.
 *
 * Platform access answers "can this role sign in from this client at all?".
 * It is deliberately separate from role-based access control, which answers
 * "what may this account do once it is signed in" and stays in roleMiddleware.
 * Keeping the two apart means a resident's feature permissions never have to
 * be restated as platform rules, and a new module cannot accidentally re-open
 * a platform this table closed.
 *
 * The policy is derived from the role, so it needs no column on the user
 * document: there is nothing per-account to keep in sync, and no admin toggle
 * that could silently grant a resident web access.
 */

const PLATFORMS = Object.freeze({
  WEB: "web",
  MOBILE: "mobile",
});

const SUPPORTED_PLATFORMS = Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]);

/**
 * MaslogCare platform access matrix.
 *
 *   admin / doctor / midwife / bhw → web + mobile
 *   resident                       → mobile only
 */
const PLATFORM_ACCESS = Object.freeze({
  admin: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  doctor: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  midwife: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  bhw: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  resident: Object.freeze([PLATFORMS.MOBILE]),
});

/**
 * An unrecognised role gets the narrowest policy rather than the widest, so a
 * role added to the User model but forgotten here fails closed.
 */
const FALLBACK_ALLOWED_PLATFORMS = Object.freeze([PLATFORMS.MOBILE]);

/** Accepts "web"/"WEB"/" Web " and rejects anything else, including null. */
function normalizePlatform(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_PLATFORMS.includes(normalized) ? normalized : null;
}

function getAllowedPlatforms(role) {
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  return PLATFORM_ACCESS[normalizedRole] || FALLBACK_ALLOWED_PLATFORMS;
}

/** The one predicate every platform decision in the system goes through. */
function isPlatformAllowed(role, platform) {
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) return false;
  return getAllowedPlatforms(role).includes(normalizedPlatform);
}

/**
 * Presentation-ready summary of a role's platform access.
 *
 * Shared by the admin User Management screen and the API that feeds it, so the
 * badge an administrator reads is generated from the same table the login path
 * enforces rather than from copy written beside it.
 */
function describePlatformAccess(role) {
  const allowedPlatforms = getAllowedPlatforms(role);
  const web = allowedPlatforms.includes(PLATFORMS.WEB);
  const mobile = allowedPlatforms.includes(PLATFORMS.MOBILE);

  return {
    allowedPlatforms: [...allowedPlatforms],
    web,
    mobile,
    label: web && mobile ? "Web + Mobile" : mobile ? "Mobile Only" : "Web Only",
  };
}

module.exports = {
  PLATFORMS,
  SUPPORTED_PLATFORMS,
  PLATFORM_ACCESS,
  normalizePlatform,
  getAllowedPlatforms,
  isPlatformAllowed,
  describePlatformAccess,
};
