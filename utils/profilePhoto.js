"use strict";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = Number(process.env.PROFILE_PHOTO_MAX_BYTES || 2_000_000); // 2MB
const DATA_URI_PREFIX_RE = /^data:(image\/[a-zA-Z0-9+.-]+);base64,/;

function isBase64String(s) {
  if (!s || typeof s !== "string") return false;
  const trimmed = s.trim();
  // Accept base64 with optional padding.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0;
}

function detectMimeFromMagic(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: "RIFF....WEBP"
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  // GIF: GIF87a / GIF89a
  if (buffer.toString("ascii", 0, 6) === "GIF87a") return "image/gif";
  if (buffer.toString("ascii", 0, 6) === "GIF89a") return "image/gif";

  return null;
}

function normalizeProfilePhoto(input) {
  if (input == null || input === "") return { ok: true, profilePhoto: "" };
  if (typeof input !== "string") return { ok: false, message: "profilePhoto must be a base64 string" };

  const raw = input.trim();
  if (raw.startsWith("file://") || raw.startsWith("content://")) {
    return { ok: false, message: "profilePhoto must be base64 data (no local file paths)" };
  }

  let mimeFromPrefix = null;
  let base64 = raw;

  const prefixMatch = raw.match(DATA_URI_PREFIX_RE);
  if (prefixMatch) {
    mimeFromPrefix = prefixMatch[1];
    base64 = raw.replace(DATA_URI_PREFIX_RE, "");
  }

  if (!isBase64String(base64)) {
    return { ok: false, message: "profilePhoto must be valid base64" };
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, message: "profilePhoto base64 could not be decoded" };
  }

  if (!buffer || buffer.length === 0) {
    return { ok: false, message: "profilePhoto is empty" };
  }
  if (buffer.length > MAX_BYTES) {
    return { ok: false, message: `profilePhoto exceeds max size of ${Math.round(MAX_BYTES / 1024 / 1024)}MB` };
  }

  const detectedMime = detectMimeFromMagic(buffer);
  const mime = mimeFromPrefix || detectedMime;
  if (!mime || !ALLOWED_MIME.has(mime)) {
    return { ok: false, message: "profilePhoto must be a JPEG, PNG, WEBP, or GIF image" };
  }

  // If a prefix was provided but magic doesn't match, treat as invalid.
  if (mimeFromPrefix && detectedMime && mimeFromPrefix !== detectedMime) {
    return { ok: false, message: "profilePhoto content type does not match provided data URI" };
  }

  const profilePhoto = `data:${mime};base64,${base64}`;
  return { ok: true, profilePhoto };
}

module.exports = {
  normalizeProfilePhoto,
};

