"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const http = require("http");
const { URL } = require("url");

const BASE = process.env.TEST_BASE_URL || `http://127.0.0.1:${process.env.PORT || 5000}/api`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "maslog@admin.gov.ph";
const ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "MaslogAdmin@2025";

const TAG = "verify-e2e";
const PASSWORD = "TestPass123!";
const emailFor = (key) => `${TAG}.${key}@maslogcare.test`;

const NATIVE = { "User-Agent": "okhttp/4.9.2", "X-Client-Platform": "mobile" };
const WEB = {
  Origin: "http://localhost:8081",
  Referer: "http://localhost:8081/",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site",
  "Sec-Fetch-Dest": "empty",
  "X-Client-Platform": "web",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function request(method, path, { body, token, headers = {}, raw = false } = {}) {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  const payload = body === undefined ? null : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          if (raw) {
            resolve({ status: res.statusCode, headers: res.headers, buffer });
            return;
          }
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: JSON.parse(buffer.toString("utf8")),
            });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, text: buffer.toString("utf8") });
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 0x20)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, 0x20)]);
const dataUri = (buffer, mime) => `data:${mime};base64,${buffer.toString("base64")}`;

function registrationPayload(key, overrides = {}) {
  return {
    firstName: "Test",
    middleName: "Verification",
    surname: key === "reject" ? "Rejectee" : "Approvee",
    suffix: "",
    dateOfBirth: "1995-06-15",
    sex: "female",
    civilStatus: "single",
    contactNumber: "09171234567",
    email: emailFor(key),
    password: PASSWORD,
    address: {
      houseNumberOrPurok: "Purok 3",
      street: "Rizal Street",
      barangay: process.env.RESIDENT_BARANGAY || "Maslog",
      cityMunicipality: process.env.RESIDENT_CITY_MUNICIPALITY || "Legazpi City",
      province: process.env.RESIDENT_PROVINCE || "Albay",
    },
    idType: "philsys",
    idNumber: "1234-5678-9012-3456",
    idFileName: "philsys_front.jpg",
    idDocument: dataUri(JPEG, "image/jpeg"),
    ...overrides,
  };
}

async function cleanup() {
  const mongoose = require("mongoose");
  const connectDB = require("../config/db");
  const User = require("../models/User");
  const ResidentVerification = require("../models/ResidentVerification");
  const Notification = require("../models/Notification");
  const { deleteIdDocumentFile } = require("../services/storageService");

  await connectDB();

  const users = await User.find({ email: new RegExp(`^${TAG}\\.`, "i") })
    .select("_id")
    .lean();
  const userIds = users.map((user) => user._id);

  if (userIds.length > 0) {
    const verifications = await ResidentVerification.find({ user: { $in: userIds } })
      .select("idFilePath")
      .lean();
    for (const verification of verifications) {
      await deleteIdDocumentFile(verification.idFilePath);
    }
    await ResidentVerification.deleteMany({ user: { $in: userIds } });
    await Notification.deleteMany({ recipient: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
  }

  await mongoose.disconnect();
  return userIds.length;
}

async function run() {
  console.log(`\nTarget: ${BASE}\n`);

  try {
    const health = await request("GET", "/health");
    if (health.status !== 200) throw new Error(`health returned ${health.status}`);
  } catch (error) {
    console.error(`Cannot reach the API at ${BASE} — is the server running?`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }

  await cleanup();

  console.log("=== Registration ===");

  const registered = await request("POST", "/register", {
    body: registrationPayload("approve"),
    headers: NATIVE,
  });
  check(
    "a valid registration is accepted",
    registered.status === 201,
    `status ${registered.status} ${JSON.stringify(registered.data ?? registered.text)}`
  );
  check(
    "the response reports pending verification rather than a session",
    registered.data?.status === "pending" && !registered.data?.token,
    JSON.stringify(registered.data)
  );

  const missingId = await request("POST", "/register", {
    body: { ...registrationPayload("noid"), idDocument: undefined, idFile: undefined },
    headers: NATIVE,
  });
  check(
    "a registration without an ID document is refused",
    missingId.status === 400 || missingId.status === 422,
    `status ${missingId.status}`
  );
  check(
    "the refusal names the ID document field",
    JSON.stringify(missingId.data ?? {}).toLowerCase().includes("iddocument"),
    JSON.stringify(missingId.data)
  );

  const badIdType = await request("POST", "/register", {
    body: registrationPayload("badtype", { idType: "library_card" }),
    headers: NATIVE,
  });
  check(
    "an unsupported ID type is refused",
    badIdType.status === 400 || badIdType.status === 422,
    `status ${badIdType.status}`
  );
  check(
    "the refusal names the ID type field",
    JSON.stringify(badIdType.data ?? {}).toLowerCase().includes("idtype"),
    JSON.stringify(badIdType.data)
  );

  const badDocument = await request("POST", "/register", {
    body: registrationPayload("badfile", {
      idDocument: dataUri(Buffer.from("GIF89a and some padding here"), "image/jpeg"),
    }),
    headers: NATIVE,
  });
  check(
    "a document whose bytes are not JPG, PNG or PDF is refused",
    badDocument.status === 400 || badDocument.status === 422,
    `status ${badDocument.status}`
  );

  console.log("\n=== Login is blocked while pending ===");

  const pendingLogin = await request("POST", "/login", {
    body: { email: emailFor("approve"), password: PASSWORD },
    headers: NATIVE,
  });
  check(
    "a pending resident is refused with 403 ACCOUNT_PENDING_VERIFICATION",
    pendingLogin.status === 403 && pendingLogin.data?.code === "ACCOUNT_PENDING_VERIFICATION",
    `status ${pendingLogin.status} code ${pendingLogin.data?.code}`
  );
  check("no token is issued to a pending resident", !pendingLogin.data?.token);

  console.log("\n=== Admin review ===");

  const adminLogin = await request("POST", "/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: WEB,
  });
  const adminToken = adminLogin.data?.token;
  check(
    "the administrator can sign in",
    adminLogin.status === 200 && Boolean(adminToken),
    `status ${adminLogin.status} ${JSON.stringify(adminLogin.data?.message ?? "")}`
  );

  if (!adminToken) {
    console.error("\nCannot continue without an administrator session.");
    await finish();
    return;
  }

  const listed = await request("GET", "/admin/user-requests?status=pending&limit=50", {
    token: adminToken,
    headers: WEB,
  });
  check("the pending queue is readable by an admin", listed.status === 200);

  const ours = (listed.data?.requests ?? []).find(
    (item) => item.resident?.email === emailFor("approve")
  );
  check("the new registration appears in the queue", Boolean(ours));
  check(
    "the queue masks ID numbers",
    Boolean(ours) &&
    ours.maskedIdNumber?.endsWith("3456") &&
    !ours.maskedIdNumber.includes("1234-5678"),
    `masked as ${ours?.maskedIdNumber}`
  );
  check(
    "the queue never carries the stored file path",
    Boolean(ours) && !JSON.stringify(ours).includes("idFilePath")
  );
  check(
    "the queue reports counts for the tab badges",
    typeof listed.data?.counts?.pending === "number"
  );

  const requestId = ours?._id;
  if (!requestId) {
    console.error("\nCannot continue without the created request.");
    await finish();
    return;
  }

  const detail = await request(`GET`, `/admin/user-requests/${requestId}`, {
    token: adminToken,
    headers: WEB,
  });
  check("the review detail loads", detail.status === 200);
  check(
    "the reviewing admin sees the unmasked ID number",
    detail.data?.request?.verification?.idNumber === "1234-5678-9012-3456",
    String(detail.data?.request?.verification?.idNumber)
  );

  console.log("\n=== The ID document is admin-only ===");

  const document = await request("GET", `/admin/user-requests/${requestId}/document`, {
    token: adminToken,
    headers: WEB,
    raw: true,
  });
  check("an admin can stream the document", document.status === 200, `status ${document.status}`);
  check(
    "it is served as an inline JPEG, not a download",
    document.headers["content-type"] === "image/jpeg" &&
    String(document.headers["content-disposition"]).startsWith("inline"),
    `${document.headers["content-type"]} / ${document.headers["content-disposition"]}`
  );
  check(
    "the document is not cached by the browser",
    String(document.headers["cache-control"]).includes("no-store"),
    String(document.headers["cache-control"])
  );
  check(
    "the streamed bytes are the uploaded document",
    document.buffer?.length === JPEG.length && document.buffer[0] === 0xff
  );

  const anonymous = await request("GET", `/admin/user-requests/${requestId}/document`, {
    headers: WEB,
  });
  check(
    "an unauthenticated request for the document is refused",
    anonymous.status === 401 || anonymous.status === 403,
    `status ${anonymous.status}`
  );

  const traversal = await request(
    "GET",
    "/admin/user-requests/..%2F..%2F..%2F.env/document",
    { token: adminToken, headers: WEB }
  );
  check(
    "a traversal in place of the id is refused, not resolved",
    traversal.status === 400 || traversal.status === 404,
    `status ${traversal.status}`
  );

  console.log("\n=== Approval ===");

  const approved = await request("PATCH", `/admin/user-requests/${requestId}/approve`, {
    token: adminToken,
    headers: WEB,
  });
  check("the request can be approved", approved.status === 200, `status ${approved.status}`);
  check(
    "the verification is recorded as approved",
    approved.data?.verification?.verificationStatus === "approved"
  );

  const reapprove = await request("PATCH", `/admin/user-requests/${requestId}/approve`, {
    token: adminToken,
    headers: WEB,
  });
  check(
    "approving twice is refused rather than applied again",
    reapprove.status === 409,
    `status ${reapprove.status}`
  );

  const approvedLogin = await request("POST", "/login", {
    body: { email: emailFor("approve"), password: PASSWORD },
    headers: NATIVE,
  });
  check(
    "the approved resident can now sign in",
    approvedLogin.status === 200 && Boolean(approvedLogin.data?.token),
    `status ${approvedLogin.status} code ${approvedLogin.data?.code}`
  );

  console.log("\n=== Rejection ===");

  const secondRegistration = await request("POST", "/register", {
    body: registrationPayload("reject", {
      idType: "drivers_license",
      idNumber: "N01-23-456789",
      idFileName: "license.pdf",
      idDocument: dataUri(PDF, "application/pdf"),
    }),
    headers: NATIVE,
  });
  check("a second registration is accepted", secondRegistration.status === 201);

  const pendingAgain = await request("GET", "/admin/user-requests?status=pending&limit=50", {
    token: adminToken,
    headers: WEB,
  });
  const second = (pendingAgain.data?.requests ?? []).find(
    (item) => item.resident?.email === emailFor("reject")
  );
  check("the second registration is queued", Boolean(second));

  if (second) {
    const noReason = await request("PATCH", `/admin/user-requests/${second._id}/reject`, {
      token: adminToken,
      headers: WEB,
      body: {},
    });
    check("rejecting without a reason is refused", noReason.status === 400, `status ${noReason.status}`);

    const otherNoRemarks = await request("PATCH", `/admin/user-requests/${second._id}/reject`, {
      token: adminToken,
      headers: WEB,
      body: { reason: "Other", remarks: "" },
    });
    check(
      '"Other" without remarks is refused',
      otherNoRemarks.status === 400,
      `status ${otherNoRemarks.status}`
    );

    const rejected = await request("PATCH", `/admin/user-requests/${second._id}/reject`, {
      token: adminToken,
      headers: WEB,
      body: { reason: "Information does not match the ID" },
    });
    check("the request can be rejected with a reason", rejected.status === 200, `status ${rejected.status}`);
    check(
      "the reason is recorded on the verification",
      rejected.data?.verification?.rejectionReason === "Information does not match the ID"
    );

    const rejectedLogin = await request("POST", "/login", {
      body: { email: emailFor("reject"), password: PASSWORD },
      headers: NATIVE,
    });
    check(
      "a rejected resident is refused with 403 REGISTRATION_REJECTED",
      rejectedLogin.status === 403 && rejectedLogin.data?.code === "REGISTRATION_REJECTED",
      `status ${rejectedLogin.status} code ${rejectedLogin.data?.code}`
    );
  }

  console.log("\n=== Non-admin access ===");

  const residentToken = approvedLogin.data?.token;
  if (residentToken) {
    const asResident = await request("GET", "/admin/user-requests", {
      token: residentToken,
      headers: NATIVE,
    });
    check(
      "a resident cannot read the verification queue",
      asResident.status === 403,
      `status ${asResident.status}`
    );

    const residentDocument = await request("GET", `/admin/user-requests/${requestId}/document`, {
      token: residentToken,
      headers: NATIVE,
    });
    check(
      "a resident cannot stream another resident's ID",
      residentDocument.status === 403,
      `status ${residentDocument.status}`
    );
  } else {
    check("a resident session was available for the negative tests", false, "no resident token");
  }

  await finish();
}

async function finish() {
  console.log("\n=== Cleanup ===");
  try {
    const removed = await cleanup();
    console.log(`  Removed ${removed} test account(s) and their documents.`);
  } catch (error) {
    console.log(`  Cleanup failed: ${error.message}`);
  }

  console.log("\n==================================================");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((line) => console.log(`  - ${line}`));
  }
  console.log("==================================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (error) => {
  console.error("Test suite crashed:", error);
  try {
    await cleanup();
  } catch {
  }
  process.exit(1);
});
