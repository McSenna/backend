"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const http = require("http");
const { URL } = require("url");
const mongoose = require("mongoose");
const User = require("../models/User");
const Appointment = require("../models/Appointment");
const SystemLog = require("../models/SystemLog");

const BASE = process.env.TEST_BASE_URL || `http://127.0.0.1:${process.env.TEST_PORT || 5000}/api`;
const TAG = "svc-e2e";
const PASSWORD = "TestPass123!";
const emailFor = (key) => `${TAG}.${key}@maslogcare.test`;

const APPROVED_LABELS = [
  "General Checkup",
  "Prenatal",
  "Immunization",
  "Consultation",
  "BP Checking",
];

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

function api(path, { method = "GET", body, token } = {}) {
  const url = new URL(`${BASE}${path}`);
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "mobile",
          "User-Agent": "okhttp/4.9.2",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data = null;
          try {
            data = JSON.parse(raw);
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
}

async function cleanup() {
  const users = await User.find({ email: { $regex: `^${TAG}\\.` } })
    .select("_id")
    .lean();
  const ids = users.map((u) => u._id);
  await Appointment.deleteMany({ resident: { $in: ids } });
  await SystemLog.deleteMany({ userId: { $in: ids } });
  await User.deleteMany({ email: { $regex: `^${TAG}\\.` } });
  return ids.length;
}

async function seed() {
  await cleanup();
  const specs = [
    { key: "resident", role: "resident", status: "active" },
    { key: "doctor", role: "doctor", status: "active" },
    { key: "midwife", role: "midwife", status: "active" },
    { key: "bhw", role: "bhw", status: "active" },
    { key: "doctor-suspended", role: "doctor", status: "suspended" },
  ];
  const created = {};
  for (const spec of specs) {
    const doc = await User.create({
      fullname: `Service Test ${spec.key}`,
      email: emailFor(spec.key),
      password: PASSWORD,
      gender: "female",
      dateOfBirth: new Date("1994-04-04"),
      address: "Purok 3, Barangay Maslog",
      phone: "09XX XXX XXXX",
      verified: true,
      status: spec.status,
      role: spec.role,
    });
    created[spec.key] = String(doc._id);
  }
  return created;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const before = await Appointment.find({})
    .select("_id status slotStart")
    .sort({ _id: 1 })
    .lean();

  const staff = await seed();

  const login = await api("/login", {
    method: "POST",
    body: { email: emailFor("resident"), password: PASSWORD, clientPlatform: "mobile" },
  });
  const token = login.data?.token;
  check("resident signs in on mobile", login.status === 200 && Boolean(token));
  check(
    "profile payload carries the contact number the form shows",
    login.data?.user?.phone === "09XX XXX XXXX",
    JSON.stringify(login.data?.user?.phone)
  );

  console.log("\n== Service catalogue: exactly the five approved services ==");
  const cats = await api("/consultation-categories", { token });
  const labels = (cats.data?.categories ?? []).map((c) => c.label);
  check("endpoint responds", cats.status === 200, `got ${cats.status}`);
  check(
    "labels and order match the approved list exactly",
    JSON.stringify(labels) === JSON.stringify(APPROVED_LABELS),
    JSON.stringify(labels)
  );
  check("no service beyond the approved five", labels.length === 5, `got ${labels.length}`);
  for (const banned of [
    "Medical Check-Up",
    "Maternal Health Consultation",
    "Child Health Consultation",
    "Family Planning Consultation",
    "Blood Pressure Monitoring",
    "Other Health Concern",
    "Immunization / Vaccination",
    "General Check-up",
  ]) {
    check(`retired label absent: "${banned}"`, !labels.includes(banned));
  }
  check(
    "every service is resident-bookable and names the role that owns it",
    (cats.data?.categories ?? []).every(
      (c) => c.residentBookable === true && typeof c.queueRole === "string" && c.queueRole.length > 0
    )
  );

  console.log("\n== Provider eligibility is derived per service ==");
  const prenatal = await api("/appointment-providers?serviceType=prenatal", { token });
  const prenatalIds = (prenatal.data?.providers ?? []).map((p) => p._id);
  check("prenatal returns 200", prenatal.status === 200, `got ${prenatal.status}`);
  check("prenatal offers the midwife", prenatalIds.includes(staff.midwife));
  check("prenatal does not offer the doctor", !prenatalIds.includes(staff.doctor));
  check("prenatal does not offer the BHW", !prenatalIds.includes(staff.bhw));

  const bp = await api("/appointment-providers?serviceType=bp_checking", { token });
  const bpIds = (bp.data?.providers ?? []).map((p) => p._id);
  check("BP Checking offers the BHW", bpIds.includes(staff.bhw));
  check("BP Checking does not offer the doctor", !bpIds.includes(staff.doctor));
  check("BP Checking does not offer the midwife", !bpIds.includes(staff.midwife));

  const consult = await api("/appointment-providers?serviceType=consultation", { token });
  const consultIds = (consult.data?.providers ?? []).map((p) => p._id);
  check("Consultation offers the doctor", consultIds.includes(staff.doctor));
  check("Consultation does not offer the midwife", !consultIds.includes(staff.midwife));
  check("Consultation does not offer the BHW", !consultIds.includes(staff.bhw));

  check(
    "a suspended provider is never offered",
    !prenatalIds.includes(staff["doctor-suspended"]) &&
    !bpIds.includes(staff["doctor-suspended"])
  );
  check(
    "provider rows carry only name and role, no contact details",
    (prenatal.data?.providers ?? []).every(
      (p) => p.fullname && p.role && p.email === undefined && p.address === undefined
    )
  );

  const unknownService = await api("/appointment-providers?serviceType=massage", { token });
  check("unknown service -> 400", unknownService.status === 400, `got ${unknownService.status}`);
  const noService = await api("/appointment-providers", { token });
  check("missing service -> 400", noService.status === 400, `got ${noService.status}`);

  console.log("\n== Booking a request ==");
  const booked = await api("/appointments", {
    method: "POST",
    token,
    body: {
      consultationType: "prenatal",
      description: "Second trimester check-up.",
      additionalNotes: "Prefers a morning visit.",
      preferredProvider: staff.midwife,
    },
  });
  check("valid request -> 201", booked.status === 201, `got ${booked.status} ${booked.data?.code}`);
  check("stored against the approved service key", booked.data?.appointment?.consultationType === "prenatal");
  check(
    "preferred provider is recorded and populated",
    booked.data?.appointment?.preferredProvider?._id === staff.midwife,
    JSON.stringify(booked.data?.appointment?.preferredProvider)
  );
  check(
    "additional notes are stored",
    booked.data?.appointment?.additionalNotes === "Prefers a morning visit."
  );
  check("request joins the queue as pending", booked.data?.appointment?.status === "pending");
  check(
    "resident never sets the schedule",
    booked.data?.appointment?.slotStart == null &&
    booked.data?.appointment?.missionSchedule == null
  );

  console.log("\n== Server-side validation ==");
  const wrongProvider = await api("/appointments", {
    method: "POST",
    token,
    body: {
      consultationType: "prenatal",
      description: "Check-up",
      preferredProvider: staff.bhw,
    },
  });
  check(
    "a provider not authorised for the service -> 400",
    wrongProvider.status === 400,
    `got ${wrongProvider.status}`
  );

  const bpToDoctor = await api("/appointments", {
    method: "POST",
    token,
    body: {
      consultationType: "bp_checking",
      description: "Routine BP reading.",
      preferredProvider: staff.doctor,
    },
  });
  check(
    "BP Checking aimed at a doctor -> 400",
    bpToDoctor.status === 400,
    `got ${bpToDoctor.status}`
  );

  const prenatalToDoctor = await api("/appointments", {
    method: "POST",
    token,
    body: {
      consultationType: "prenatal",
      description: "Maternal check.",
      preferredProvider: staff.doctor,
    },
  });
  check(
    "Prenatal aimed at a doctor -> 400",
    prenatalToDoctor.status === 400,
    `got ${prenatalToDoctor.status}`
  );

  const suspendedProvider = await api("/appointments", {
    method: "POST",
    token,
    body: {
      consultationType: "consultation",
      description: "Check-up",
      preferredProvider: staff["doctor-suspended"],
    },
  });
  check(
    "a suspended provider -> 400",
    suspendedProvider.status === 400,
    `got ${suspendedProvider.status}`
  );

  const noType = await api("/appointments", {
    method: "POST",
    token,
    body: { description: "Check-up" },
  });
  check("missing service type -> 400", noType.status === 400, `got ${noType.status}`);

  const badType = await api("/appointments", {
    method: "POST",
    token,
    body: { consultationType: "blood_pressure_monitoring", description: "Check-up" },
  });
  check(
    "a retired service key -> 400",
    badType.status === 400,
    `got ${badType.status}`
  );

  const noProvider = await api("/appointments", {
    method: "POST",
    token,
    body: { consultationType: "bp_checking", description: "Routine BP reading." },
  });
  check(
    "a request with no provider preference is still accepted",
    noProvider.status === 201 && noProvider.data?.appointment?.preferredProvider == null,
    `got ${noProvider.status}`
  );

  console.log("\n== Reading the requests back ==");
  const mine = await api("/appointments/me", { token });
  check("my appointments -> 200", mine.status === 200, `got ${mine.status}`);
  check("both requests are listed", (mine.data?.appointments ?? []).length === 2);
  check(
    "the preferred provider is populated for display",
    (mine.data?.appointments ?? []).some((a) => a.preferredProvider?.fullname)
  );

  const prenatalId = booked.data?.appointment?._id;
  const bpId = noProvider.data?.appointment?._id;

  console.log("\n== Each queue shows only its own services ==");

  async function signIn(key) {
    const res = await api("/login", {
      method: "POST",
      body: { email: emailFor(key), password: PASSWORD, clientPlatform: "web" },
    });
    return res.data?.token;
  }

  const QUEUE_SERVICES = {
    doctor: ["consultation", "general_checkup"],
    midwife: ["prenatal", "immunization"],
    bhw: ["bp_checking"],
  };

  for (const [role, allowed] of Object.entries(QUEUE_SERVICES)) {
    const staffToken = await signIn(role);
    check(`${role} signs in`, Boolean(staffToken));
    if (!staffToken) continue;

    const queue = await api("/appointments/pending", { token: staffToken });
    check(`${role} queue -> 200`, queue.status === 200, `got ${queue.status}`);

    const rows = queue.data?.appointments ?? [];
    const strayed = rows.filter((a) => !allowed.includes(a.consultationType));
    check(
      `${role} queue contains only ${allowed.join(" / ")}`,
      strayed.length === 0,
      strayed.map((a) => a.consultationType).join(",")
    );
    check(
      `${role} queue tags every row with its owning role`,
      rows.every((a) => a.queueRole === role),
      rows.map((a) => a.queueRole).join(",")
    );

    const ids = rows.map((a) => String(a._id));
    check(
      `the prenatal request is ${role === "midwife" ? "in" : "absent from"} the ${role} queue`,
      ids.includes(String(prenatalId)) === (role === "midwife")
    );
    check(
      `the BP request is ${role === "bhw" ? "in" : "absent from"} the ${role} queue`,
      ids.includes(String(bpId)) === (role === "bhw")
    );

    const widened = await api("/appointments/pending?role=admin", { token: staffToken });
    const widenedStray = (widened.data?.appointments ?? []).filter(
      (a) => !allowed.includes(a.consultationType)
    );
    check(
      `${role} cannot widen their queue with ?role=`,
      widenedStray.length === 0,
      widenedStray.map((a) => a.consultationType).join(",")
    );
  }

  console.log("\n== Overview is scoped to the caller's own services ==");

  const ROLE_SERVICES = {
    doctor: ["consultation", "general_checkup"],
    midwife: ["prenatal", "immunization"],
    bhw: ["bp_checking"],
  };

  for (const [role, allowed] of Object.entries(ROLE_SERVICES)) {
    const staffToken = await signIn(role);
    const ov = await api("/appointments/overview", { token: staffToken });
    check(`${role} overview -> 200`, ov.status === 200, `got ${ov.status}`);

    const rows = ov.data?.breakdown ?? [];
    const keys = rows.map((r) => r.key);
    check(
      `${role} breakdown lists exactly their services`,
      keys.length === allowed.length && allowed.every((k) => keys.includes(k)),
      keys.join(",")
    );
    check(
      `${role} breakdown never names another role's service`,
      rows.every((r) => allowed.includes(r.key))
    );
    check(
      `${role} breakdown rows carry a label and a numeric count`,
      rows.every((r) => typeof r.label === "string" && Number.isInteger(r.count))
    );

    const sched = ov.data?.schedule ?? [];
    check(
      `${role} schedule holds only their services`,
      sched.every((a) => allowed.includes(a.consultationType)),
      sched.map((a) => a.consultationType).join(",")
    );
    check(
      `${role} schedule is ordered by time`,
      sched.every((a, i) => i === 0 || new Date(sched[i - 1].slotStart) <= new Date(a.slotStart))
    );

    const stats = ov.data?.stats ?? {};
    check(
      `${role} stats are all numbers`,
      ["today", "pending", "upcoming", "declined"].every((k) => Number.isInteger(stats[k])),
      JSON.stringify(stats)
    );

    const list = await api("/appointments?status=pending", { token: staffToken });
    check(
      `${role} pending count matches their own pending list`,
      (ov.data?.statusCounts?.pending ?? -1) === (list.data?.appointments ?? []).length,
      `${ov.data?.statusCounts?.pending} vs ${(list.data?.appointments ?? []).length}`
    );

    const widened = await api("/appointments/overview?role=admin", { token: staffToken });
    check(
      `${role} cannot widen the overview with ?role=`,
      (widened.data?.breakdown ?? []).every((r) => allowed.includes(r.key)),
      (widened.data?.breakdown ?? []).map((r) => r.key).join(",")
    );
  }

  console.log("\n== Only the doctor may open a mission ==");

  const missionBody = {
    date: "2027-01-14",
    morning: { start: "08:00", end: "12:00" },
    afternoon: { start: "13:00", end: "17:00" },
    categories: [{ categoryKey: "bp_checking", durationMinutes: 5 }],
  };

  for (const role of ["midwife", "bhw"]) {
    const staffToken = await signIn(role);
    const attempt = await api("/mission-schedule", {
      method: "POST",
      token: staffToken,
      body: missionBody,
    });
    check(
      `${role} posting a mission directly -> 403`,
      attempt.status === 403,
      `got ${attempt.status}`
    );
  }

  const residentMission = await api("/mission-schedule", {
    method: "POST",
    token,
    body: missionBody,
  });
  check(
    "a resident posting a mission -> 403",
    residentMission.status === 403,
    `got ${residentMission.status}`
  );

  console.log("\n== Existing data left untouched ==");
  const after = await Appointment.find({ _id: { $in: before.map((a) => a._id) } })
    .select("_id status slotStart")
    .sort({ _id: 1 })
    .lean();
  check(
    "pre-existing appointments are unchanged",
    JSON.stringify(before) === JSON.stringify(after),
    `${before.length} before / ${after.length} after`
  );

  const removed = await cleanup();
  console.log(`\nCleaned up ${removed} test accounts and their appointments.`);
  await mongoose.disconnect();

  console.log(`\n================ ${passed} passed, ${failed} failed ================`);
  if (failed) {
    console.log("Failures:");
    failures.forEach((f) => console.log(` - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}

run().catch(async (error) => {
  console.error("Harness error:", error);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch { }
  process.exit(1);
});
