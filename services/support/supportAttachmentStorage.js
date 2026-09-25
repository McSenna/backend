"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../../utils/logger");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");
const { SUPPORT_LIMITS } = require("../../config/support");
const { detectMimeFromBytes, extensionForMime } = require("../storage/mimeDetection");

const SUPPORT_STORAGE_DIR = path.resolve(__dirname, "../../storage/support");

const attachmentError = (message) =>
  badRequest(message, ERROR_CODES.VALIDATION_ERROR, { fieldErrors: { attachments: message } });

const sanitizeFileName = (name) =>
  path.basename(String(name || "attachment")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);

const decodeAttachment = (attachment) => {
  const raw = typeof attachment?.data === "string" ? attachment.data.trim() : "";
  const base64 = raw.replace(/^data:[^;]+;base64,/, "");
  const buffer = base64 ? Buffer.from(base64, "base64") : null;

  if (!buffer || buffer.length === 0) {
    throw attachmentError("One of the attached files is empty or could not be read.");
  }
  if (buffer.length > SUPPORT_LIMITS.maxAttachmentBytes) {
    throw attachmentError("Each attached file must be 5 MB or smaller.");
  }

  const mimeType = detectMimeFromBytes(buffer);
  if (!mimeType || !SUPPORT_LIMITS.allowedMimes.includes(mimeType)) {
    throw attachmentError("Only JPG, JPEG, PNG, and PDF files can be attached.");
  }

  return { buffer, mimeType, fileName: sanitizeFileName(attachment.fileName) };
};

const deleteSupportAttachments = async (storedFileNames) => {
  await Promise.all(
    storedFileNames.map(async (storedFileName) => {
      try {
        await fs.promises.unlink(path.join(SUPPORT_STORAGE_DIR, path.basename(storedFileName)));
      } catch (error) {
        logger.warn("Could not delete support attachment", {
          errorName: error?.name,
          errorMessage: error?.message,
        });
      }
    })
  );
};

// Validates every file before writing any, so a bad file never leaves orphans behind.
const saveSupportAttachments = async (attachments) => {
  if (attachments === undefined || attachments === null) return [];
  if (!Array.isArray(attachments)) {
    throw attachmentError("Attachments must be sent as a list of files.");
  }
  if (attachments.length > SUPPORT_LIMITS.maxAttachments) {
    throw attachmentError(`You can attach up to ${SUPPORT_LIMITS.maxAttachments} files.`);
  }

  const decoded = attachments.map(decodeAttachment);
  if (decoded.length === 0) return [];

  await fs.promises.mkdir(SUPPORT_STORAGE_DIR, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(SUPPORT_STORAGE_DIR, 0o700);

  const saved = [];
  try {
    for (const { buffer, mimeType, fileName } of decoded) {
      const storedFileName = `${crypto.randomUUID()}${extensionForMime(mimeType)}`;
      await fs.promises.writeFile(path.join(SUPPORT_STORAGE_DIR, storedFileName), buffer, {
        mode: 0o600,
      });
      saved.push({
        id: crypto.randomUUID(),
        fileName,
        mimeType,
        fileSize: buffer.length,
        storedFileName,
      });
    }
  } catch (error) {
    await deleteSupportAttachments(saved.map((file) => file.storedFileName));
    throw error;
  }

  return saved;
};

module.exports = { SUPPORT_STORAGE_DIR, saveSupportAttachments, deleteSupportAttachments };
