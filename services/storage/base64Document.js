"use strict";

const { ID_DOCUMENT_LIMITS } = require("../../config/idVerification");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { detectMimeFromBytes } = require("./mimeDetection");

const REJECTED_PREFIXES = ["file://", "content://", "http://", "https://"];

const DATA_URI = /^data:([a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+);base64,/;

const readBase64Payload = (input) => {
  if (!input || typeof input !== "string") {
    throw badRequest("Government ID document is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  const raw = input.trim();
  if (REJECTED_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
    throw badRequest(
      "Direct file paths or URLs are not accepted. Please upload the file directly.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const dataUriMatch = raw.match(DATA_URI);
  return {
    mimeFromPrefix: dataUriMatch ? dataUriMatch[1].toLowerCase() : null,
    base64: dataUriMatch ? raw.replace(DATA_URI, "") : raw,
  };
};

const decodeBuffer = (base64) => {
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw badRequest(
      "Could not decode the uploaded ID document. File may be corrupted.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  if (!buffer || buffer.length === 0) {
    throw badRequest("The uploaded ID document is empty.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (buffer.length > ID_DOCUMENT_LIMITS.maxBytes) {
    throw badRequest(
      "The uploaded ID document exceeds the maximum size limit of 10MB.",
      ERROR_CODES.PAYLOAD_TOO_LARGE
    );
  }

  return buffer;
};

const resolveDocumentMime = (buffer, mimeFromPrefix) => {
  const detectedMime = detectMimeFromBytes(buffer);
  if (!detectedMime) {
    throw badRequest(
      "Unsupported or corrupted file format. Only JPG, PNG, and PDF documents are allowed.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  if (!ID_DOCUMENT_LIMITS.allowedMimes.includes(detectedMime || mimeFromPrefix)) {
    throw badRequest(
      "Only JPG, JPEG, PNG, and PDF files are allowed for ID verification.",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  return detectedMime;
};

const decodeIdDocument = (input) => {
  const { mimeFromPrefix, base64 } = readBase64Payload(input);
  const buffer = decodeBuffer(base64);
  return { buffer, mimeType: resolveDocumentMime(buffer, mimeFromPrefix) };
};

module.exports = { decodeIdDocument };
