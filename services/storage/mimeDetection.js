"use strict";

const MAGIC_SIGNATURES = [
  { mime: "image/jpeg", extension: ".jpg", bytes: [0xff, 0xd8, 0xff] },
  {
    mime: "image/png",
    extension: ".png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: "application/pdf", extension: ".pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

const matchesSignature = (buffer, bytes) =>
  buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

const detectMimeFromBytes = (buffer) => {
  if (!buffer || buffer.length < 5) return null;
  return MAGIC_SIGNATURES.find((sig) => matchesSignature(buffer, sig.bytes))?.mime ?? null;
};

const extensionForMime = (mime) =>
  MAGIC_SIGNATURES.find((sig) => sig.mime === mime)?.extension ?? ".bin";

module.exports = { detectMimeFromBytes, extensionForMime };
