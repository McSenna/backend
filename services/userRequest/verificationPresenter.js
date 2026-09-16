"use strict";

const { maskIdNumber } = require("../../config/idVerification");

const LIST_USER_FIELDS =
  "fullname email phone address addressDetails gender dateOfBirth profilePhoto createdAt status";

const DETAIL_USER_FIELDS =
  "fullname firstName middleName surname suffix email phone address addressDetails gender civilStatus dateOfBirth profilePhoto createdAt status";

const toListRow = (item) => {
  const user = item.user || {};
  return {
    _id: String(item._id),
    userId: user._id ? String(user._id) : null,
    resident: {
      fullname: user.fullname || "Resident",
      email: user.email || "",
      phone: user.phone || "",
      address: user.address || "",
      gender: user.gender || "",
      dateOfBirth: user.dateOfBirth || null,
      avatarUrl: user.profilePhoto || null,
      status: user.status || item.verificationStatus,
    },
    idType: item.idType,
    idTypeName: item.idTypeName,
    maskedIdNumber: maskIdNumber(item.idNumber),
    idMimeType: item.idMimeType,
    idFileSize: item.idFileSize,
    verificationStatus: item.verificationStatus,
    rejectionReason: item.rejectionReason || "",
    rejectionRemarks: item.rejectionRemarks || "",
    verifiedBy: item.verifiedBy?.fullname || null,
    verifiedAt: item.verifiedAt || null,
    registeredAt: item.createdAt,
  };
};

const toDetail = (verification) => {
  const user = verification.user || {};
  return {
    _id: String(verification._id),
    userId: user._id ? String(user._id) : null,
    resident: {
      fullname: user.fullname || "",
      firstName: user.firstName || "",
      middleName: user.middleName || "",
      surname: user.surname || "",
      suffix: user.suffix || "",
      email: user.email || "",
      phone: user.phone || "",
      gender: user.gender || "",
      civilStatus: user.civilStatus || "",
      dateOfBirth: user.dateOfBirth || null,
      address: user.address || "",
      addressDetails: user.addressDetails || null,
      avatarUrl: user.profilePhoto || null,
      accountStatus: user.status || verification.verificationStatus,
      registrationDate: user.createdAt || verification.createdAt,
    },
    verification: {
      idType: verification.idType,
      idTypeName: verification.idTypeName,
      idNumber: verification.idNumber,
      maskedIdNumber: maskIdNumber(verification.idNumber),
      idFileName: verification.idFileName || "document",
      idMimeType: verification.idMimeType,
      idFileSize: verification.idFileSize,
      verificationStatus: verification.verificationStatus,
      rejectionReason: verification.rejectionReason || "",
      rejectionRemarks: verification.rejectionRemarks || "",
      verifiedBy: verification.verifiedBy?.fullname || null,
      verifiedAt: verification.verifiedAt || null,
      submittedAt: verification.createdAt,
      documentUrl: `/api/admin/user-requests/${verification._id}/document`,
    },
  };
};

const tallyCounts = (aggregation) => {
  const counts = { pending: 0, approved: 0, rejected: 0, total: 0 };
  aggregation.forEach((item) => {
    if (item._id in counts) counts[item._id] = item.count;
    counts.total += item.count;
  });
  return counts;
};

module.exports = { LIST_USER_FIELDS, DETAIL_USER_FIELDS, toListRow, toDetail, tallyCounts };
