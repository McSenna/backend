"use strict";

const SENSITIVE_METADATA_KEYS = [
  "password",
  "newpassword",
  "oldpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessionsecret",
  "secret",
  "apikey",
  "otp",
  "otpcode",
  "pin",
];

const isSensitiveKey = (key) =>
  SENSITIVE_METADATA_KEYS.includes(key.toLowerCase().replace(/[_\s-]/g, ""));

const sanitizeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") return {};

  const sanitizeValue = (value) => {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === "object") return sanitizeObject(value);
    return value;
  };

  const sanitizeObject = (obj) =>
    Object.entries(obj).reduce((acc, [key, value]) => {
      acc[key] = isSensitiveKey(key) ? "[REDACTED]" : sanitizeValue(value);
      return acc;
    }, {});

  return sanitizeObject(metadata);
};

module.exports = { sanitizeMetadata };
