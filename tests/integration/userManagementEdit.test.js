"use strict";
// The SMTP transport is stubbed, so no real email is sent.
process.env.EMAIL_ENABLED = "true";
process.env.EMAIL_PROVIDER = "smtp";
process.env.EMAIL_USER = "sender@maslogcare.test";
process.env.EMAIL_PASSWORD = "test-app-password";
const assert = require("node:assert/strict");
const http = require("http");
const { io: connect } = require("socket.io-client");
const h = require("./helpers/masterListHarness");
const User = require("../../models/User");
const PasswordReset = require("../../models/PasswordReset");
const SystemLog = require("../../models/SystemLog");
const { transporter } = require("../../services/mailer/transporter");
const { createApp } = require("../../app");
const { attachRealtime, closeRealtime } = require("../../realtime/socketServer");
const { initializeResidentWebAccess } = require("../../services/residentWebAccess");

let seq = 0;
const make = (role, status = role === "resident" ? "approved" : "active", extra = {}) => {
  seq += 1;
  return User.create({ fullname: `Synthetic ${role} ${seq}`, email: `${role}.edit.${seq}@maslogcare.test`, password: "SyntheticPass123!", role, status, verified: ["approved", "active"].includes(status), phone: "09170000000", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Purok 1, Test", ...extra });
};
const stored = (user) => User.findById(user._id).lean();
const stamp = async (user) => (await stored(user)).updatedAt.toISOString();

const run = async () => {
  await h.setup();
  await initializeResidentWebAccess();
  const admin = await make("admin");
  const headers = h.asAdmin(admin);
  const edit = (user, body, as = headers) => h.request(`/users/${user._id}`, { method: "PATCH", headers: as, body });
  const role = (user, body, as = headers) => h.request(`/users/${user._id}/role`, { method: "PATCH", headers: as, body });
  const reset = (user, as = headers) => h.request(`/users/${user._id}/password-reset`, { method: "POST", headers: as, body: {} });

  const resident = await make("resident");
  const changed = await edit(resident, { fullname: "Synthetic Renamed", phone: "09171234567", updatedAt: await stamp(resident) });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.user.fullname, "Synthetic Renamed");
  assert.equal((await stored(resident)).phone, "09171234567");
  const editLog = await SystemLog.findOne({ action: "USER_UPDATED", resourceId: String(resident._id) }).lean();
  assert.deepEqual([...editLog.metadata.fields].sort(), ["fullname", "phone"], "the log names fields");
  assert.equal(JSON.stringify(editLog).includes("09171234567"), false, "the log holds no values");
  for (const extra of [{ role: "admin" }, { email: "x@maslogcare.test" }, { status: "active" }, { residentWebAccessOverride: "allow" }]) {
    assert.equal((await edit(resident, { ...extra, updatedAt: await stamp(resident) })).status, 400, JSON.stringify(extra));
  }
  assert.equal((await edit(resident, { fullname: "x", updatedAt: await stamp(resident) })).status, 400, "reuses the name rule");
  assert.equal((await edit(resident, { phone: "12", updatedAt: await stamp(resident) })).status, 400, "reuses the phone rule");
  assert.equal((await edit(resident, { fullname: "Synthetic Other" })).status, 400, "needs the version it was edited from");
  assert.equal((await edit(resident, { fullname: "Synthetic Other", updatedAt: "2020-01-01T00:00:00.000Z" })).status, 409, "stale save");

  const parted = await make("resident", "approved", { firstName: "Old", middleName: "Middle", surname: "Name", fullname: "Old Middle Name" });
  assert.equal((await edit(parted, { fullname: "Fixed Corrected Surname", updatedAt: await stamp(parted) })).status, 200);
  const partedRow = await stored(parted);
  assert.equal(partedRow.firstName, "Fixed");
  assert.equal(partedRow.middleName, "Corrected");
  assert.equal(partedRow.surname, "Surname");
  await User.updateOne({ _id: parted._id }, { $set: { residentWebAccessOverride: "allow" } });
  const partedToken = (await h.request("/login", { method: "POST", body: { email: parted.email, password: "SyntheticPass123!", clientPlatform: "web" } })).body.token;
  await h.request("/profile", { method: "PATCH", headers: { Authorization: `Bearer ${partedToken}` }, body: { middleName: "Newer" } });
  assert.equal((await stored(parted)).fullname, "Fixed Newer Surname", "an admin's correction survives the resident's later edit");

  const doctor = await make("doctor");
  const moved = await role(doctor, { role: "midwife", updatedAt: await stamp(doctor) });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((await stored(doctor)).role, "midwife");
  const roleLog = await SystemLog.findOne({ action: "USER_ROLE_CHANGED", resourceId: String(doctor._id) }).lean();
  assert.equal(roleLog.metadata.previousRole, "doctor");
  assert.equal(roleLog.metadata.newRole, "midwife");
  assert.equal((await role(doctor, { role: "resident", updatedAt: await stamp(doctor) })).status, 409, "staff cannot become residents");
  assert.equal((await role(resident, { role: "bhw", updatedAt: await stamp(resident) })).status, 409, "residents cannot become staff");
  assert.equal((await role(doctor, { role: "owner", updatedAt: await stamp(doctor) })).status, 400);
  assert.equal((await role(doctor, { role: "bhw", updatedAt: "2020-01-01T00:00:00.000Z" })).status, 409, "stale save");
  const demoteSelf = await role(admin, { role: "doctor", updatedAt: await stamp(admin) });
  assert.equal(demoteSelf.status, 403);
  assert.equal(demoteSelf.body.code, "SELF_ACTION_FORBIDDEN");
  const second = await make("admin");
  assert.equal((await role(second, { role: "bhw", updatedAt: await stamp(second) })).status, 200, "another admin can be demoted");
  assert.equal((await role(second, { role: "admin", updatedAt: await stamp(second) })).status, 200, "and promoted");

  const socketServer = http.createServer(createApp());
  attachRealtime(socketServer);
  await new Promise((resolve) => socketServer.listen(0, "127.0.0.1", resolve));
  const nurse = await make("midwife");
  const socket = connect(`http://127.0.0.1:${socketServer.address().port}`, { transports: ["websocket"], auth: { token: h.tokenFor(nurse) }, reconnection: false });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  const dropped = new Promise((resolve) => socket.once("disconnect", resolve));
  assert.equal((await role(nurse, { role: "bhw", updatedAt: await stamp(nurse) })).status, 200);
  await dropped;
  closeRealtime();
  await new Promise((resolve) => socketServer.close(resolve));

  const target = await make("resident", "active");
  const sent = [];
  transporter.sendMail = async ({ to }) => { sent.push(to); return { messageId: "synthetic", accepted: [to] }; };
  const ok = await reset(target);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(sent.length, 1);
  assert.ok(String(sent[0]).includes(target.email));
  assert.ok(await PasswordReset.findOne({ email: target.email }).lean());
  const resetLog = await SystemLog.findOne({ action: "USER_PASSWORD_RESET_SENT", resourceId: String(target._id) }).lean();
  assert.equal(String(resetLog.userId), String(admin._id));
  assert.equal(JSON.stringify(resetLog).includes((await PasswordReset.findOne({ email: target.email }).lean()).otp), false, "the code is never logged");
  assert.equal((await reset(target)).status, 429, "resend cooldown");
  assert.equal((await reset(await make("resident", "deactivated"))).status, 409);
  assert.equal((await reset(await make("resident", "pending"))).status, 409);
  const selfReset = await reset(admin);
  assert.equal(selfReset.body.code, "SELF_ACTION_FORBIDDEN");

  const failing = await make("resident", "active");
  transporter.sendMail = async () => { throw Object.assign(new Error("SMTP down"), { responseCode: 550 }); };
  const failed = await reset(failing, h.asAdmin(second));
  assert.equal(failed.status, 502, JSON.stringify(failed.body));
  assert.equal(failed.body.code, "EMAIL_SEND_FAILED");
  assert.equal(await PasswordReset.findOne({ email: failing.email }).lean(), null, "no code is left behind");
  assert.equal(await SystemLog.findOne({ action: "USER_PASSWORD_RESET_SENT", resourceId: String(failing._id) }).lean(), null, "no success is logged");

  const silent = await make("resident", "active");
  transporter.sendMail = async () => { throw new Error("must not send while email is off"); };
  process.env.EMAIL_ENABLED = "false";
  const notSent = await reset(silent, h.asAdmin(second));
  process.env.EMAIL_ENABLED = "true";
  assert.equal(notSent.status, 502, `email switched off must not report success: ${JSON.stringify(notSent.body)}`);
  assert.equal(notSent.body.code, "EMAIL_SEND_FAILED");
  assert.equal(await PasswordReset.findOne({ email: silent.email }).lean(), null, "no code starts a cooldown");

  for (const path of [["PATCH", `/users/${target._id}`], ["PATCH", `/users/${target._id}/role`], ["POST", `/users/${target._id}/password-reset`]]) {
    assert.equal((await h.request(path[1], { method: path[0], body: {} })).status, 401, path[1]);
    for (const asRole of ["doctor", "midwife", "bhw", "resident"]) {
      assert.equal((await h.request(path[1], { method: path[0], headers: h.asAdmin(await make(asRole)), body: {} })).status, 403, `${asRole} ${path[1]}`);
    }
  }

  const busyAdmin = await make("admin");
  const busy = h.asAdmin(busyAdmin);
  const hit = () => h.request(`/users/${target._id}/status`, { method: "PATCH", headers: busy, body: { action: "nothing" } });
  for (let index = 0; index < 60; index += 1) assert.equal((await hit()).status, 400, `write ${index}`);
  const limited = await hit();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "RATE_LIMITED");
  assert.equal((await edit(target, { fullname: "Synthetic Fine", updatedAt: await stamp(target) })).status, 200, "limits are per admin");
  console.log("User management edit assertions passed");
};
run().then(() => h.teardown()).catch(async (error) => { console.error(error); closeRealtime(); await h.teardown(); process.exitCode = 1; });
