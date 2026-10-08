"use strict";

// Sign-up and sign-in with an address from any provider, end to end through the
// real API on an in-memory database. Mail runs in mock mode, so the code is read
// from the sender's dev-only log line instead of a mailbox. Every account and
// address here is test data.
const http = require("http");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

const BACKEND = path.resolve(__dirname, "..", "..");
const backendRequire = require("module").createRequire(path.join(BACKEND, "package.json"));
const PORT = Number(process.env.TEST_PORT || 5098);
const PASSWORD = "TestPass123!";
const ADDRESS = "Maria.Santos+Clinic@Outlook.PH";
const STORED = "maria.santos+clinic@outlook.ph";
const LOOK_ALIKE = "mariasantos+clinic@outlook.ph";
const NATIVE = { "User-Agent": "okhttp/4.9.2", "X-Client-Platform": "mobile" };
const WEB = { Origin: "http://localhost:8081", "X-Client-Platform": "web", "User-Agent": "Mozilla/5.0 Chrome/120" };

let passed = 0;
let failed = 0;
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failed += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` (${detail})` : ""}`);
};

const request = (method, route, { body, token, headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: `/api${route}`,
        method,
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
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

// The mock sender logs "[DEV ONLY] Simulation OTP for j***@x: [123456]"; keep the latest code.
let lastCode = null;
const realLog = console.log;
console.log = (...args) => {
  const match = /Simulation OTP for .*\[(\d{6})\]/.exec(args.join(" "));
  if (match) {
    lastCode = match[1];
    return;
  }
  realLog(...args);
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 0x20)]);
const registration = (email, emailVerificationToken) => ({
  firstName: "Test",
  middleName: "Email",
  surname: "Fixture",
  suffix: "",
  dateOfBirth: "1995-06-15",
  sex: "female",
  civilStatus: "single",
  contactNumber: "09171234567",
  email,
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
  idDocument: `data:image/jpeg;base64,${JPEG.toString("base64")}`,
  emailVerificationToken,
});

const run = async () => {
  console.log("\n=== Address format ===");
  for (const bad of ["a@b..com", ".a@b.com", "a@@b.com", "a@b.c"]) {
    const sent = await request("POST", "/email-verification/send", { body: { email: bad }, headers: NATIVE });
    check(`"${bad}" is refused as a format error`, sent.status === 400 && sent.data?.code === "INVALID_FORMAT", `${sent.status} ${sent.data?.code}`);
  }

  console.log("\n=== Ownership is verified for the exact address ===");
  const sent = await request("POST", "/email-verification/send", { body: { email: ADDRESS }, headers: NATIVE });
  check("a code is sent to an Outlook address with a plus tag", sent.status === 200 && Boolean(lastCode), `${sent.status} ${sent.data?.code}`);

  const wrongDigit = lastCode === "000000" ? "111111" : "000000";
  const wrong = await request("POST", "/email-verification/verify", { body: { email: ADDRESS, otp: wrongDigit }, headers: NATIVE });
  check("a wrong code is refused", wrong.status === 400 && wrong.data?.code === "OTP_INVALID", `${wrong.status} ${wrong.data?.code}`);

  const otherAddress = await request("POST", "/email-verification/verify", { body: { email: LOOK_ALIKE, otp: lastCode }, headers: NATIVE });
  check("the code does not verify a look-alike address", otherAddress.status === 400, `${otherAddress.status} ${otherAddress.data?.code}`);

  const verified = await request("POST", "/email-verification/verify", { body: { email: ADDRESS, otp: lastCode }, headers: NATIVE });
  const token = verified.data?.verificationToken;
  check("the right code verifies the address", verified.status === 200 && Boolean(token), `${verified.status} ${verified.data?.code}`);
  check("the verification is for the address as entered (case aside)", verified.data?.email === STORED, verified.data?.email);

  const borrowed = await request("POST", "/register", { body: registration(LOOK_ALIKE, token), headers: NATIVE });
  check("its verification cannot register a look-alike address", borrowed.status === 400 && borrowed.data?.code === "EMAIL_NOT_VERIFIED", `${borrowed.status} ${borrowed.data?.code}`);

  const registered = await request("POST", "/register", { body: registration(ADDRESS, token), headers: NATIVE });
  check("the verified address registers", registered.status === 201, `${registered.status} ${registered.data?.code} ${registered.data?.message}`);

  const User = backendRequire("./models/User");
  const stored = await User.findOne({ email: STORED }).lean();
  check("the account holds the exact address, with its dots and plus tag", Boolean(stored));
  check("no account was made for the look-alike", !(await User.findOne({ email: LOOK_ALIKE }).lean()));

  const reused = await request("POST", "/register", { body: registration(ADDRESS, token), headers: NATIVE });
  check("a second registration is refused as already in use", reused.status === 409 && reused.data?.code === "EMAIL_EXISTS", `${reused.status} ${reused.data?.code}`);
  const resend = await request("POST", "/email-verification/send", { body: { email: ADDRESS.toLowerCase() }, headers: NATIVE });
  check("a new code for a registered address is refused as already in use", resend.status === 409 && resend.data?.code === "EMAIL_EXISTS", `${resend.status} ${resend.data?.code}`);
  const lookAlikeCode = await request("POST", "/email-verification/send", { body: { email: LOOK_ALIKE }, headers: NATIVE });
  check("the look-alike address is treated as a different, free address", lookAlikeCode.status === 200, `${lookAlikeCode.status} ${lookAlikeCode.data?.code}`);

  console.log("\n=== Sign-in takes an email address only ===");
  for (const identifier of ["09171234567", "+63 917 123 4567", "maria.santos"]) {
    const refused = await request("POST", "/login", { body: { email: identifier, password: PASSWORD }, headers: NATIVE });
    check(
      `"${identifier}" is refused as not an email address`,
      refused.status === 400 && refused.data?.code === "INVALID_FORMAT" && /email address/i.test(refused.data?.message ?? "") && !refused.data?.token,
      `${refused.status} ${refused.data?.code}`
    );
  }

  console.log("\n=== Sign-in authenticates the exact address ===");
  const unknown = await request("POST", "/login", { body: { email: "nobody.here@yahoo.com", password: PASSWORD }, headers: NATIVE });
  const wrongPassword = await request("POST", "/login", { body: { email: ADDRESS, password: "WrongPass123!" }, headers: NATIVE });
  const lookAlikeLogin = await request("POST", "/login", { body: { email: LOOK_ALIKE, password: PASSWORD }, headers: NATIVE });
  check("an unregistered address is refused", unknown.status === 401 && unknown.data?.code === "INVALID_CREDENTIALS", `${unknown.status} ${unknown.data?.code}`);
  check("a wrong password is refused", wrongPassword.status === 401 && wrongPassword.data?.code === "INVALID_CREDENTIALS", `${wrongPassword.status} ${wrongPassword.data?.code}`);
  check("both refusals look the same, so the form cannot reveal who has an account", unknown.data?.message === wrongPassword.data?.message);
  check("the look-alike address does not sign in to this account", lookAlikeLogin.status === 401 && !lookAlikeLogin.data?.token);

  const adminLogin = await request("POST", "/login", {
    body: { email: process.env.ADMIN_EMAIL || "maslog@admin.gov.ph", password: process.env.ADMIN_DEFAULT_PASSWORD || "MaslogAdmin@2025" },
    headers: WEB,
  });
  const adminToken = adminLogin.data?.token;
  if (stored && resolvePending(stored) && adminToken) {
    const listed = await request("GET", "/admin/user-requests?status=pending&limit=50", { token: adminToken, headers: WEB });
    const ours = (listed.data?.requests ?? []).find((item) => item.resident?.email === STORED);
    if (ours) await request("PATCH", `/admin/user-requests/${ours._id ?? ours.id}/approve`, { token: adminToken, headers: WEB });
  }
  const signedIn = await request("POST", "/login", { body: { email: ADDRESS, password: PASSWORD }, headers: NATIVE });
  check("the owner signs in with the address in any letter case", signedIn.status === 200 && Boolean(signedIn.data?.token), `${signedIn.status} ${signedIn.data?.code}`);
  check("the session belongs to the exact address", signedIn.data?.user?.email === STORED, signedIn.data?.user?.email);
};

const resolvePending = (user) => user.status !== "active" && user.status !== "approved";

const main = async () => {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri("maslogcare_email_test");
  process.chdir(BACKEND);
  backendRequire("dotenv").config({ path: path.join(BACKEND, ".env") });
  Object.assign(process.env, { MONGO_URI: uri, NODE_ENV: "development", EMAIL_PROVIDER: "mock" });

  const { createApp } = backendRequire("./app");
  await backendRequire("./config/db")();
  await backendRequire("./services/seedAdmin").seedAdmin();
  const server = await new Promise((resolve) => {
    const listening = createApp().listen(PORT, "127.0.0.1", () => resolve(listening));
  });

  try {
    await run();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await backendRequire("mongoose").disconnect().catch(() => undefined);
    await mongo.stop();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error("Runner failed:", error);
  process.exit(1);
});
