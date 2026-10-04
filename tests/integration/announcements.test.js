"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const User = require("../../models/User");
const Announcement = require("../../models/Announcement");
const Notification = require("../../models/Notification");
const SystemLog = require("../../models/SystemLog");

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

async function request(path, options = {}) {
  const url = new URL(`${baseUrl}${path}`);
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const body = options.rawBody ?? (options.body ? JSON.stringify(options.body) : null);

  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function setup() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

async function teardown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

let emailSeq = 0;
const makeUser = (role, status, extra = {}) =>
  User.create({
    fullname: `${role} ${status} ${++emailSeq}`,
    email: `${role}.${status}.${emailSeq}@maslogcare.test`,
    password: "InitialPass123!",
    role,
    verified: status === "approved" || status === "active",
    status,
    phone: "09171234567",
    gender: "female",
    dateOfBirth: new Date("1990-01-01"),
    address: "Purok 1, Maslog",
    ...extra,
  });

const headersFor = (user, platform = "web") => ({
  Authorization: `Bearer ${jwt.sign(
    { userId: String(user._id), role: user.role, platform },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  )}`,
  "X-Client-Platform": platform,
});

const inDays = (days, hour = 9) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const validBody = () => ({
  title: "Free vaccination drive",
  message: "Bring your child's immunization card. Walk-ins are welcome all morning.",
  eventAt: inDays(3),
  location: "Barangay Maslog Health Center",
});

async function runTests() {
  const admin = await makeUser("admin", "active");
  const otherAdmin = await makeUser("admin", "active");
  const doctor = await makeUser("doctor", "active");
  const resident = await makeUser("resident", "approved");
  const pending = await makeUser("resident", "pending");
  const suspended = await makeUser("resident", "suspended");

  const adminHeaders = headersFor(admin);
  const post = (body, headers = adminHeaders) =>
    request("/admin/announcements", { method: "POST", headers, body });

  console.log("\nAuthorization");

  const anonymous = await post(validBody(), {});
  check("rejects unauthenticated create with 401", anonymous.status === 401, `got ${anonymous.status}`);

  const asDoctor = await post(validBody(), headersFor(doctor));
  check("rejects non-admin create with 403", asDoctor.status === 403, `got ${asDoctor.status}`);

  const asResident = await post(validBody(), headersFor(resident, "mobile"));
  check("rejects resident create with 403", asResident.status === 403, `got ${asResident.status}`);

  const residentAdminList = await request("/admin/announcements", {
    headers: headersFor(resident, "mobile"),
  });
  check("rejects resident reading the admin list with 403", residentAdminList.status === 403);

  check("nothing was stored by rejected requests", (await Announcement.countDocuments()) === 0);

  console.log("\nValidation");

  const empty = await post({});
  const emptyErrors = empty.body.fieldErrors || {};
  check(
    "empty body returns 400 with an error for every field",
    empty.status === 400 &&
      ["title", "message", "eventAt", "location"].every((field) => typeof emptyErrors[field] === "string"),
    JSON.stringify(empty.body)
  );

  const shortTitle = await post({ ...validBody(), title: "Hi" });
  check(
    "short title is rejected on the title field",
    shortTitle.status === 400 && /at least/.test(shortTitle.body.fieldErrors?.title || "")
  );

  const whitespace = await post({ ...validBody(), location: "     " });
  check(
    "whitespace-only location counts as missing",
    whitespace.status === 400 && whitespace.body.fieldErrors?.location === "Location is required."
  );

  const tooLong = await post({ ...validBody(), message: "x".repeat(801) });
  check("over-long message is rejected", tooLong.status === 400 && Boolean(tooLong.body.fieldErrors?.message));

  const badDate = await post({ ...validBody(), eventAt: "next friday" });
  check(
    "non-ISO date is rejected",
    badDate.status === 400 && badDate.body.fieldErrors?.eventAt === "Enter a valid date and time."
  );

  const nextYear = new Date().getFullYear() + 1;
  const impossibleDate = await post({ ...validBody(), eventAt: `${nextYear}-02-30T09:00:00.000Z` });
  check(
    "impossible calendar date is rejected, not rolled into March",
    impossibleDate.status === 400 && impossibleDate.body.fieldErrors?.eventAt === "Enter a valid date and time."
  );

  const impossibleTime = await post({ ...validBody(), eventAt: `${nextYear}-01-10T24:30:00.000Z` });
  check("impossible clock time is rejected", impossibleTime.status === 400);

  const numericDate = await post({ ...validBody(), eventAt: 1767225600000 });
  check("numeric timestamp is rejected", numericDate.status === 400 && Boolean(numericDate.body.fieldErrors?.eventAt));

  const pastDate = await post({ ...validBody(), eventAt: inDays(-2) });
  check(
    "past date is rejected",
    pastDate.status === 400 && pastDate.body.fieldErrors?.eventAt === "The date cannot be in the past."
  );

  const farDate = await post({ ...validBody(), eventAt: inDays(400) });
  check("date beyond a year is rejected", farDate.status === 400 && /within/.test(farDate.body.fieldErrors?.eventAt || ""));

  const wrongTypes = await post({ title: ["x"], message: { a: 1 }, eventAt: true, location: 12 });
  check("non-string fields are rejected", wrongTypes.status === 400);

  const malformed = await request("/admin/announcements", {
    method: "POST",
    headers: adminHeaders,
    rawBody: "{ not json",
  });
  check("malformed JSON is rejected with 400", malformed.status === 400, `got ${malformed.status}`);

  check("invalid requests stored nothing", (await Announcement.countDocuments()) === 0);
  check("invalid requests sent no notifications", (await Notification.countDocuments()) === 0);

  console.log("\nCreate and deliver");

  const created = await post({ ...validBody(), title: "  Free vaccination drive  " });
  const announcement = created.body.announcement || {};
  check("admin create returns 201", created.status === 201, JSON.stringify(created.body));
  check("title is trimmed", announcement.title === "Free vaccination drive");
  check("create response names the author", announcement.postedBy === admin.fullname, `got ${announcement.postedBy}`);
  check("eventAt is echoed as ISO", typeof announcement.eventAt === "string" && !Number.isNaN(Date.parse(announcement.eventAt)));
  check(
    "recipientCount covers the sign-in-ready accounts except the author",
    announcement.recipientCount === 3,
    `got ${announcement.recipientCount}`
  );

  const notified = await Notification.find({ type: "announcement" }).lean();
  const recipients = new Set(notified.map((n) => String(n.recipient)));
  check("one inbox alert per recipient", notified.length === 3 && recipients.size === 3);
  check(
    "active staff, other admins and approved residents are notified",
    [otherAdmin, doctor, resident].every((user) => recipients.has(String(user._id)))
  );
  check(
    "author, pending and suspended accounts are not notified",
    [admin, pending, suspended].every((user) => !recipients.has(String(user._id)))
  );
  check(
    "alerts link back to the announcement and carry the where",
    notified.every((n) => String(n.announcement) === announcement.id && n.body.includes("Barangay Maslog Health Center"))
  );

  const log = await SystemLog.findOne({ action: "ANNOUNCEMENT_CREATED" }).lean();
  check("the post is written to the system log", Boolean(log) && log.resourceId === announcement.id);

  console.log("\nFeed");

  const residentFeed = await request("/announcements", { headers: headersFor(resident, "mobile") });
  const residentItem = residentFeed.body.announcements?.[0] || {};
  check("resident can read the feed", residentFeed.status === 200 && residentFeed.body.announcements.length === 1);
  check(
    "feed item carries what, when and where",
    residentItem.title === "Free vaccination drive" &&
      residentItem.message.length > 0 &&
      residentItem.eventAt === announcement.eventAt &&
      residentItem.location === "Barangay Maslog Health Center"
  );
  check(
    "feed hides admin-only fields",
    !("postedBy" in residentItem) && !("recipientCount" in residentItem) && !("createdBy" in residentItem)
  );

  const doctorFeed = await request("/announcements", { headers: headersFor(doctor) });
  check("staff can read the feed", doctorFeed.status === 200 && doctorFeed.body.announcements.length === 1);

  const anonymousFeed = await request("/announcements");
  check("feed requires sign-in", anonymousFeed.status === 401);

  const inbox = await request("/notifications", { headers: headersFor(resident, "mobile") });
  check(
    "the alert appears in the resident's existing inbox",
    inbox.status === 200 && inbox.body.notifications.some((n) => n.type === "announcement" && n.title === "Free vaccination drive")
  );

  const inboxItem = inbox.body.notifications.find((n) => n.type === "announcement") || {};
  check(
    "the inbox alert carries the announcement id it opens",
    inboxItem.announcementId === announcement.id,
    `got ${inboxItem.announcementId}`
  );

  console.log("\nDetail");

  const detail = await request(`/announcements/${announcement.id}`, { headers: headersFor(resident, "mobile") });
  const detailItem = detail.body.announcement || {};
  check(
    "a recipient can open the full announcement",
    detail.status === 200 &&
      detailItem.id === announcement.id &&
      detailItem.message === residentItem.message &&
      detailItem.eventAt === announcement.eventAt &&
      detailItem.location === "Barangay Maslog Health Center",
    JSON.stringify(detail.body)
  );
  check(
    "detail hides admin-only fields",
    !("postedBy" in detailItem) && !("recipientCount" in detailItem) && !("createdBy" in detailItem)
  );

  const staffDetail = await request(`/announcements/${announcement.id}`, { headers: headersFor(doctor) });
  check("staff can open the full announcement", staffDetail.status === 200);

  const anonymousDetail = await request(`/announcements/${announcement.id}`);
  check("detail requires sign-in", anonymousDetail.status === 401);

  const invalidDetail = await request("/announcements/not-an-id", { headers: headersFor(resident, "mobile") });
  check(
    "malformed announcement id is rejected with 400",
    invalidDetail.status === 400 && invalidDetail.body.code === "INVALID_ID",
    JSON.stringify(invalidDetail.body)
  );

  const missingDetail = await request(`/announcements/${new mongoose.Types.ObjectId()}`, {
    headers: headersFor(resident, "mobile"),
  });
  check(
    "a removed announcement answers 404 with its own code",
    missingDetail.status === 404 && missingDetail.body.code === "ANNOUNCEMENT_NOT_FOUND",
    JSON.stringify(missingDetail.body)
  );

  await post({ ...validBody(), title: "Blood pressure screening" });
  await post({ ...validBody(), title: "Nutrition seminar" });

  const firstPage = await request("/admin/announcements?limit=2", { headers: adminHeaders });
  check(
    "admin list is newest first with author name",
    firstPage.status === 200 &&
      firstPage.body.announcements[0].title === "Nutrition seminar" &&
      firstPage.body.announcements[0].postedBy === admin.fullname &&
      firstPage.body.hasMore === true
  );

  const secondPage = await request(
    `/admin/announcements?limit=2&cursor=${firstPage.body.nextCursor}`,
    { headers: adminHeaders }
  );
  check(
    "cursor serves the remaining page without repeats",
    secondPage.status === 200 &&
      secondPage.body.announcements.length === 1 &&
      secondPage.body.announcements[0].title === "Free vaccination drive" &&
      secondPage.body.hasMore === false
  );

  const badCursor = await request("/announcements?cursor=nope", { headers: headersFor(resident, "mobile") });
  check("malformed cursor is rejected with 400", badCursor.status === 400);

  console.log("\nDrafts and audiences");

  const residentHeaders = headersFor(resident, "mobile");
  const doctorHeaders = headersFor(doctor);
  const feedTitles = async (headers) =>
    ((await request("/announcements?limit=50", { headers })).body.announcements || []).map((a) => a.title);

  const draft = await post({ ...validBody(), title: "Draft clinic hours", isDraft: true });
  const draftItem = draft.body.announcement || {};
  check("a draft is saved with 201", draft.status === 201 && draftItem.isDraft === true, JSON.stringify(draft.body));
  check("a draft notifies nobody", draftItem.recipientCount === 0 && (await Notification.countDocuments({ title: "Draft clinic hours" })) === 0);
  check("a draft stays out of the shared feed", !(await feedTitles(residentHeaders)).includes("Draft clinic hours"));
  const draftDetail = await request(`/announcements/${draftItem.id}`, { headers: residentHeaders });
  check("a draft cannot be opened from the feed", draftDetail.status === 404);
  const adminTitles = ((await request("/admin/announcements?limit=50", { headers: adminHeaders })).body.announcements || []).map((a) => a.title);
  check("admins still see the draft", adminTitles.includes("Draft clinic hours"));

  const staffOnly = await post({ ...validBody(), title: "Staff meeting notes", audience: "Staff" });
  const staffAlerts = await Notification.find({ title: "Staff meeting notes" }).lean();
  const staffRecipients = new Set(staffAlerts.map((n) => String(n.recipient)));
  check("a staff announcement echoes its audience", staffOnly.body.announcement?.audience === "Staff");
  check(
    "a staff announcement reaches staff only",
    staffRecipients.size === 2 && staffRecipients.has(String(doctor._id)) && staffRecipients.has(String(otherAdmin._id))
  );
  check("residents do not see staff announcements", !(await feedTitles(residentHeaders)).includes("Staff meeting notes"));
  check("staff see staff announcements", (await feedTitles(doctorHeaders)).includes("Staff meeting notes"));

  const badAudience = await post({ ...validBody(), audience: "Visitors" });
  check("an unknown audience is rejected", badAudience.status === 400 && Boolean(badAudience.body.fieldErrors?.audience));

  const endsBeforeEvent = await post({ ...validBody(), eventAt: inDays(5), expiresAt: inDays(4) });
  check(
    "an end date before the event is rejected",
    endsBeforeEvent.status === 400 && Boolean(endsBeforeEvent.body.fieldErrors?.expiresAt)
  );

  const ending = await post({ ...validBody(), title: "Ended outreach", expiresAt: inDays(10) });
  check("an end date is stored and echoed", ending.status === 201 && typeof ending.body.announcement?.expiresAt === "string");
  await Announcement.updateOne({ _id: ending.body.announcement.id }, { $set: { expiresAt: new Date(Date.now() - 60000) } });
  check("an ended announcement leaves the shared feed", !(await feedTitles(residentHeaders)).includes("Ended outreach"));

  console.log("\nEdit");

  const patch = (id, body, headers = adminHeaders) =>
    request(`/admin/announcements/${id}`, { method: "PATCH", headers, body });
  const draftBody = { ...validBody(), title: "Draft clinic hours", audience: "Patients" };

  const doctorPatch = await patch(draftItem.id, { ...draftBody, isDraft: false }, doctorHeaders);
  check("non-admins cannot edit", doctorPatch.status === 403);

  const published = await patch(draftItem.id, { ...draftBody, isDraft: false });
  check(
    "posting a draft sends it to its audience",
    published.status === 200 && published.body.announcement?.isDraft === false && published.body.announcement?.recipientCount === 1,
    JSON.stringify(published.body)
  );
  const draftAlerts = await Notification.find({ title: "Draft clinic hours" }).lean();
  check("the posted draft reached the patient", draftAlerts.length === 1 && String(draftAlerts[0].recipient) === String(resident._id));

  const backToDraft = await patch(draftItem.id, { ...draftBody, isDraft: true });
  check("a posted announcement cannot go back to drafts", backToDraft.status === 400 && Boolean(backToDraft.body.fieldErrors?.isDraft));

  await Announcement.updateOne({ _id: announcement.id }, { $set: { eventAt: new Date(Date.now() - 2 * 86400000) } });
  const pastEventAt = (await Announcement.findById(announcement.id).lean()).eventAt.toISOString();
  const renamed = await patch(announcement.id, { ...validBody(), title: "Vaccination drive moved indoors", eventAt: pastEventAt });
  check("an unchanged past event date does not block an edit", renamed.status === 200, JSON.stringify(renamed.body));
  check(
    "editing updates the alerts already delivered",
    (await Notification.countDocuments({ announcement: announcement.id, title: "Vaccination drive moved indoors" })) === 3
  );
  check("the edit is written to the system log", Boolean(await SystemLog.findOne({ action: "ANNOUNCEMENT_UPDATED" }).lean()));

  const missingPatch = await patch(new mongoose.Types.ObjectId(), validBody());
  check("editing a missing announcement answers 404", missingPatch.status === 404);

  console.log("\nDelete");

  const remove = (id, headers = adminHeaders) => request(`/admin/announcements/${id}`, { method: "DELETE", headers });

  check("non-admins cannot delete", (await remove(announcement.id, doctorHeaders)).status === 403);
  const removed = await remove(announcement.id);
  check("admin delete returns 200", removed.status === 200 && removed.body.id === announcement.id);
  check("the announcement is gone", !(await Announcement.findById(announcement.id)));
  check("its inbox alerts are gone", (await Notification.countDocuments({ announcement: announcement.id })) === 0);
  check("the delete is written to the system log", Boolean(await SystemLog.findOne({ action: "ANNOUNCEMENT_DELETED" }).lean()));
  check("deleting again answers 404", (await remove(announcement.id)).status === 404);

  console.log("\nDelivery failure");

  const before = await Announcement.countDocuments();
  const realInsertMany = Notification.insertMany.bind(Notification);
  Notification.insertMany = async () => {
    throw new Error("simulated notification outage");
  };
  const outage = await post({ ...validBody(), title: "Should not be posted" });
  Notification.insertMany = realInsertMany;

  check("delivery failure returns 503", outage.status === 503, `got ${outage.status}`);
  check("delivery failure leaves no announcement behind", (await Announcement.countDocuments()) === before);
  check(
    "delivery failure leaves no stray alerts",
    (await Notification.countDocuments({ title: "Should not be posted" })) === 0
  );
}

(async () => {
  console.log("\n--- Testing Announcements API ---");
  try {
    await setup();
    await runTests();
  } catch (error) {
    failed += 1;
    failures.push(`Unexpected error: ${error.stack || error.message}`);
    console.error(error);
  } finally {
    await teardown();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    failures.forEach((failure) => console.log(`  - ${failure}`));
    process.exit(1);
  }
})();
