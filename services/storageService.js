"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");
const { badRequest } = require("../utils/AppError");
const { ERROR_CODES } = require("../utils/errorCodes");
const { decodeIdDocument } = require("./storage/base64Document");
const { extensionForMime } = require("./storage/mimeDetection");

const VERIFICATION_STORAGE_DIR = path.resolve(__dirname, "../storage/verifications");

if (!fs.existsSync(VERIFICATION_STORAGE_DIR)) {
  fs.mkdirSync(VERIFICATION_STORAGE_DIR, { recursive: true, mode: 0o700 });
}

const isInsideStorage = (candidate) => {
  const relative = path.relative(VERIFICATION_STORAGE_DIR, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const sanitizeOriginalName = (originalName) =>
  path.basename(String(originalName || "id_document")).replace(/[^a-zA-Z0-9._-]/g, "_");

const saveGovernmentIdDocument = async (input, originalName = "id_document") => {
  const { buffer, mimeType } = decodeIdDocument(input);

  const secureFileName = `${crypto.randomUUID()}${extensionForMime(mimeType)}`;
  const targetFilePath = path.join(VERIFICATION_STORAGE_DIR, secureFileName);

  if (!isInsideStorage(targetFilePath)) {
    throw badRequest("Invalid storage path.", ERROR_CODES.VALIDATION_ERROR);
  }

  await fs.promises.writeFile(targetFilePath, buffer, { mode: 0o600 });

  return {
    filePath: secureFileName,
    mimeType,
    fileSize: buffer.length,
    fileName: sanitizeOriginalName(originalName),
  };
};

const resolveIdDocumentPath = (storedFileName) => {
  if (!storedFileName || typeof storedFileName !== "string") return null;

  const resolved = path.join(VERIFICATION_STORAGE_DIR, path.basename(storedFileName));
  if (!isInsideStorage(resolved)) return null;
  if (!fs.existsSync(resolved)) return null;

  return resolved;
};

const deleteIdDocumentFile = async (storedFileName) => {
  const filePath = resolveIdDocumentPath(storedFileName);
  if (!filePath) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    logger.warn("Could not delete stored ID document", {
      errorName: error?.name,
      errorMessage: error?.message,
    });
  }
};

module.exports = {
  VERIFICATION_STORAGE_DIR,
  saveGovernmentIdDocument,
  resolveIdDocumentPath,
  deleteIdDocumentFile,
};
