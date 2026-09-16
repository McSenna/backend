"use strict";

const fs = require("fs");
const ResidentVerification = require("../../models/ResidentVerification");
const asyncHandler = require("../../utils/asyncHandler");
const { HTTP_STATUS, ERROR_CODES } = require("../../utils/errorCodes");
const { badRequest, notFound } = require("../../utils/AppError");
const { isValidObjectId } = require("../../utils/objectId");
const { resolveIdDocumentPath } = require("../../services/storageService");

const setPrivateHeaders = (res, { mimeType, downloadName }) => {
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${downloadName}"`);
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
};

exports.serveIdDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    throw badRequest("A valid verification ID is required.", ERROR_CODES.VALIDATION_ERROR);
  }

  const verification = await ResidentVerification.findById(id).lean();
  if (!verification) {
    throw notFound("Verification record not found.", ERROR_CODES.NOT_FOUND);
  }

  const resolvedPath = resolveIdDocumentPath(verification.idFilePath);
  if (!resolvedPath) {
    throw notFound(
      "The requested ID document could not be found on the server.",
      ERROR_CODES.NOT_FOUND
    );
  }

  setPrivateHeaders(res, {
    mimeType: verification.idMimeType || "application/octet-stream",
    downloadName: verification.idFileName || `verification-${verification.idType}`,
  });

  const stream = fs.createReadStream(resolvedPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to read ID document from storage.",
      });
    }
  });

  stream.pipe(res);
});
