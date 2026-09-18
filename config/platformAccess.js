"use strict";

const PLATFORMS = Object.freeze({
  WEB: "web",
  MOBILE: "mobile",
});

const SUPPORTED_PLATFORMS = Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]);

const PLATFORM_ACCESS = Object.freeze({
  admin: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  doctor: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  midwife: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  bhw: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
  resident: Object.freeze([PLATFORMS.WEB, PLATFORMS.MOBILE]),
});

const FALLBACK_ALLOWED_PLATFORMS = Object.freeze([PLATFORMS.MOBILE]);

function normalizePlatform(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_PLATFORMS.includes(normalized) ? normalized : null;
}

function getAllowedPlatforms(role) {
  const normalizedRole = typeof role === "string" ? role.trim().toLowerCase() : "";
  return PLATFORM_ACCESS[normalizedRole] || FALLBACK_ALLOWED_PLATFORMS;
}

function isPlatformAllowed(role, platform) {
  const normalizedPlatform = normalizePlatform(platform);
  if (!normalizedPlatform) return false;
  return getAllowedPlatforms(role).includes(normalizedPlatform);
}

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
