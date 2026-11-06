"use strict";

// A password change keeps the device that made it signed in, live feed
// included, and drops every other session. Every account here is invented.
process.env.EMAIL_PROVIDER = "mock";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";

const http = require("http");
const mongoose = require("mongoose");
const { io: connect } = require("socket.io-client");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const { attachRealtime } = require("../../realtime/socketServer");
const { getRealtimeServer } = require("../../realtime/broadcast");
const { reauthorizeSocket } = require("../../realtime/residentAuthorization");
const User = require("../../models/User");
const { createChecker } = require("./helpers/appointmentHarness");
const { waitFor, expectSilence, nextConnect } = require("./helpers/realtimeHarness");

const PASSWORD = "InitialPass123!";
const NEW_PASSWORD = "NewSecure456!";

// http.request, not fetch: Node's fetch sends Fetch Metadata headers, which
// the server rightly reads as a browser and refuses for a mobile session.
const post = (baseUrl, path, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${baseUrl}/api${path}`,
      { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Platform": "mobile", ...headers } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
      }
    );
    req.on("error", reject);
    req.end(payload);
  });

const run = async (baseUrl, check) => {
  const user = await User.create({
    fullname: "Test Fixture Socket",
    email: "socket.change@maslogcare.test",
    password: PASSWORD,
    role: "resident",
    verified: true,
    status: "approved",
    phone: "09171234567",
    gender: "female",
    dateOfBirth: new Date("1995-05-15"),
    address: "Test purok",
  });

  const login = async () => {
    const res = await post(baseUrl, "/login", { email: user.email, password: PASSWORD });
    return res.body.token;
  };
  const open = (token) =>
    connect(baseUrl, { transports: ["websocket"], reconnection: false, auth: { token, platform: "mobile" } });

  const [changingToken, otherToken] = [await login(), await login()];
  const changing = open(changingToken);
  const other = open(otherToken);
  check("both sessions connect", (await nextConnect(changing)).connected && (await nextConnect(other)).connected);

  const otherDropped = waitFor(other, "disconnect");
  const res = await post(
    baseUrl,
    "/change-password",
    { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
    { Authorization: `Bearer ${changingToken}` }
  );
  check("the change succeeds", res.status === 200 && typeof res.body.token === "string", JSON.stringify(res.body));
  check("the other session's live feed is dropped", (await otherDropped) === "io server disconnect");

  // What the 15-second resident recheck and every resident delivery run.
  const revoked = waitFor(changing, "access:revoked", 1500);
  const live = [...getRealtimeServer().sockets.sockets.values()];
  const results = await Promise.all(live.map(reauthorizeSocket));
  check("the changing device's socket passes the recheck", results.length === 1 && results[0] === true, JSON.stringify(results));
  check("the changing device is not told its access was revoked", (await revoked) === null);
  check("the changing device's socket stays connected", changing.connected && (await expectSilence(changing, "disconnect")));

  const stale = await nextConnect(open(otherToken));
  check("the other session cannot reconnect with its old token", stale.error?.data?.code === "INVALID_TOKEN");

  changing.close();
  other.close();
};

const main = async () => {
  const { check, tally } = createChecker();
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const server = http.createServer(createApp());
  attachRealtime(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`, check);
  } catch (error) {
    check("change password socket suite ran to the end", false, error?.message);
  }

  getRealtimeServer()?.disconnectSockets(true);
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
  console.log(`\nResults: ${tally.passed} passed, ${tally.failed} failed.`);
  process.exit(tally.failed > 0 ? 1 : 0);
};

main();
