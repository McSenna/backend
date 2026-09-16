"use strict";

const { saveGovernmentIdDocument } = require("../storageService");
const { SUPPORTED_ID_TYPES } = require("../../config/idVerification");
const { badRequest } = require("../../utils/AppError");
const { ERROR_CODES } = require("../../utils/errorCodes");

const readIdSubmission = (body) => ({
  document: body.idDocument || body.idFile || body.uploadedId || "",
  type: String(body.idType || "").trim(),
  number: String(body.idNumber || "").trim(),
  fileName: String(body.idFileName || "government_id").trim(),
});

const matchIdType = (idType) =>
  SUPPORTED_ID_TYPES.find(
    (candidate) =>
      candidate.id.toLowerCase() === idType.toLowerCase() ||
      candidate.label.toLowerCase() === idType.toLowerCase()
  );

const prepareGovernmentId = async (body) => {
  const submission = readIdSubmission(body);

  if (!submission.type) {
    throw badRequest("Please select a valid Government ID Type.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (!submission.number) {
    throw badRequest("Government ID Number is required.", ERROR_CODES.VALIDATION_ERROR);
  }
  if (!submission.document) {
    throw badRequest(
      "Please upload a valid Government ID document (JPG, PNG, or PDF).",
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const savedDoc = await saveGovernmentIdDocument(submission.document, submission.fileName);
  const matchedType = matchIdType(submission.type);

  return {
    idType: matchedType ? matchedType.id : submission.type,
    idTypeName: matchedType ? matchedType.label : submission.type,
    idNumber: submission.number,
    idFilePath: savedDoc.filePath,
    idFileName: savedDoc.fileName,
    idMimeType: savedDoc.mimeType,
    idFileSize: savedDoc.fileSize,
  };
};

module.exports = { prepareGovernmentId };
