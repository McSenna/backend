"use strict";

// Harness for the Barangay Master List registration tests: an in-memory
// database, the real app, and fixtures. Every person here is invented.

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", "..", ".env") });
const http = require("http");
const crypto = require("crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../../app");
const User = require("../../../models/User");
const MasterResident = require("../../../models/MasterResident");
const ResidentVerification = require("../../../models/ResidentVerification");
const EmailVerification = require("../../../models/EmailVerification");
const { deleteIdDocumentFile } = require("../../../services/storageService");
const { RESIDENCY } = require("../../../config/residency");

let mongod;
let server;
let baseUrl;
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

const MOBILE = { "User-Agent": "okhttp/4.9.2", "X-Client-Platform": "mobile" };

function request(path, { method = "GET", body, headers = {} } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(`${baseUrl}${path}`),
      { method, headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const json = (response) => JSON.stringify(response.body);
const setAutoVerify = (on) => {
  process.env.MASTER_LIST_AUTO_VERIFY = on ? "true" : "false";
};

const tokenFor = (user, platform = "web") =>
  jwt.sign({ userId: String(user._id), role: user.role, platform }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
const asAdmin = (admin) => ({ Authorization: `Bearer ${tokenFor(admin)}`, "X-Client-Platform": "web" });

// Registration needs a finished email-code step; seed it like the client would.
async function verifiedEmailToken(email) {
  const token = crypto.randomBytes(32).toString("hex");
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
  await EmailVerification.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        verified: true,
        verifiedAt: new Date(),
        verificationToken: token,
        tokenExpires: inAnHour,
        expiresAt: inAnHour,
      },
      $unset: { consumedAt: 1 },
    },
    { upsert: true }
  );
  return token;
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 0x20)]);

const defaultAddress = () => ({
  houseNumberOrPurok: "Purok 3",
  street: "Sampaguita St.",
  barangay: RESIDENCY.barangay,
  cityMunicipality: RESIDENCY.cityMunicipality,
  province: RESIDENCY.province,
});

let emailSeq = 0;
async function register(person, extra = {}) {
  const email = `master.${++emailSeq}@maslogcare.test`;
  const body = {
    firstName: "Testa",
    middleName: "Sample",
    surname: "Fixture",
    suffix: "",
    dateOfBirth: "1990-04-12",
    sex: "female",
    civilStatus: "single",
    contactNumber: "09171234567",
    email,
    password: "TestPass123!",
    idType: "philsys",
    idNumber: "0000-0000-0000-0000",
    idFileName: "test_id.jpg",
    idDocument: `data:image/jpeg;base64,${JPEG.toString("base64")}`,
    ...person,
    ...extra,
  };
  body.address = { ...defaultAddress(), ...(person.address ?? {}) };
  body.emailVerificationToken = await verifiedEmailToken(email);
  const response = await request("/register", { method: "POST", body, headers: MOBILE });
  const user = await User.findOne({ email }).lean();
  const verification = user ? await ResidentVerification.findOne({ user: user._id }).lean() : null;
  return { response, user, verification, email };
}

const MASTER_FIXTURES = [
  {
    masterResidentId: "TEST-A",
    firstName: "Testa",
    middleName: "Sample",
    lastName: "Fixture",
    dateOfBirth: new Date("1990-04-12T00:00:00.000Z"),
    sex: "female",
    civilStatus: "single",
    barangay: RESIDENCY.barangay,
    address: `Purok 3, Sampaguita Street, ${RESIDENCY.barangay}`,
  },
  ...["TEST-B1", "TEST-B2"].map((masterResidentId) => ({
    masterResidentId,
    firstName: "Duo",
    middleName: "Sample",
    lastName: "Twin",
    dateOfBirth: new Date("1985-01-01T00:00:00.000Z"),
    sex: "male",
    civilStatus: "married",
    barangay: `Brgy. ${RESIDENCY.barangay}`,
    address: "Purok 1, Acacia Street",
  })),
  {
    masterResidentId: "TEST-D",
    firstName: "Gone",
    lastName: "Away",
    dateOfBirth: new Date("1970-02-02T00:00:00.000Z"),
    sex: "male",
    civilStatus: "widowed",
    barangay: RESIDENCY.barangay,
    address: "Purok 2, Narra Street",
    isActive: false,
  },
  {
    masterResidentId: "TEST-E",
    firstName: "Other",
    lastName: "Place",
    dateOfBirth: new Date("1999-09-09T00:00:00.000Z"),
    sex: "female",
    civilStatus: "single",
    barangay: "Elsewhere",
    address: "Purok 9, Faraway Road",
  },
  {
    masterResidentId: "TEST-F",
    firstName: "Fern",
    middleName: "Sample",
    lastName: "Linked",
    dateOfBirth: new Date("2001-07-20T00:00:00.000Z"),
    sex: "female",
    civilStatus: "single",
    barangay: RESIDENCY.barangay,
    address: "Purok 4, Molave Street",
  },
];

async function setup() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), MasterResident.init(), ResidentVerification.init()]);
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

async function teardown() {
  const stored = await ResidentVerification.find().select("idFilePath").lean().catch(() => []);
  for (const { idFilePath } of stored) await deleteIdDocumentFile(idFilePath);
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

module.exports = {
  check,
  request,
  json,
  setAutoVerify,
  tokenFor,
  asAdmin,
  register,
  setup,
  teardown,
  MASTER_FIXTURES,
  MOBILE,
  summary: () => ({ passed, failed, failures }),
};
