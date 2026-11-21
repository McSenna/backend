"use strict";

// Session count and the two logout scopes, through the real app and middleware.
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env"), quiet: true });
process.env.EMAIL_PROVIDER = "mock";
const http = require("http");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const User = require("../../models/User");
const AuthSession = require("../../models/AuthSession");
const { describeDevice } = require("../../services/auth/authSessions");

const CHROME_LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
const PASSWORD = "Synthetic1!";

let mongod;
let server;
let baseUrl;
let failed = 0;

const check = (name, condition, detail = "") => {
  if (!condition) failed += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` — ${detail}` : ""}`);
};

const request = (path, { method = "GET", token, body, agent = CHROME_LINUX } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json", "X-Client-Platform": "web", "User-Agent": agent };
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(new URL(`${baseUrl}${path}`), { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

const signIn = async (email, agent) => {
  const res = await request("/login", { method: "POST", body: { email, password: PASSWORD }, agent });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
};

const makeAdmin = (email) =>
  User.create({
    fullname: "Test Admin", email, password: PASSWORD, role: "admin", verified: true, status: "approved",
    phone: "09170000000", gender: "female", dateOfBirth: new Date("1990-01-01"), address: "Test address",
  });

async function run() {
  check("describeDevice reads OS and browser", describeDevice(CHROME_LINUX) === "Linux · Chrome" && describeDevice(FIREFOX_WINDOWS) === "Windows · Firefox");
  check("describeDevice returns null for an unknown agent", describeDevice("okhttp/4.12.0") === null);

  await makeAdmin("scope.one@maslogcare.test");
  const first = await signIn("scope.one@maslogcare.test", CHROME_LINUX);
  const second = await signIn("scope.one@maslogcare.test", FIREFOX_WINDOWS);

  const listed = await request("/sessions", { token: first });
  check("Two sign-ins count as two sessions", listed.status === 200 && listed.body.count === 2, JSON.stringify(listed.body));
  const current = listed.body.sessions?.find((session) => session.current);
  check("Exactly one session is marked current, with its device", listed.body.sessions?.filter((s) => s.current).length === 1 && current?.device === "Linux · Chrome");
  check("Session ids never leave the server", listed.body.sessions?.every((session) => !("sessionId" in session)));

  const bad = await request("/logout", { method: "POST", token: first, body: { scope: "everything" } });
  check("An unknown scope is refused with 400", bad.status === 400);

  const single = await request("/logout", { method: "POST", token: second, body: {} });
  check("A missing scope logs out this device only", single.status === 200 && single.body.scope === "this");
  const afterSingle = await request("/sessions", { token: first });
  check("The other device no longer counts", afterSingle.body.count === 1, JSON.stringify(afterSingle.body));

  await makeAdmin("scope.two@maslogcare.test");
  const a = await signIn("scope.two@maslogcare.test", CHROME_LINUX);
  const b = await signIn("scope.two@maslogcare.test", FIREFOX_WINDOWS);
  const all = await request("/logout", { method: "POST", token: a, body: { scope: "all" } });
  check("scope all succeeds", all.status === 200 && all.body.scope === "all");
  check("scope all revokes the other device's token", (await request("/sessions", { token: b })).status === 401);
  check("scope all revokes this device's token too", (await request("/sessions", { token: a })).status === 401);
  const open = await AuthSession.countDocuments({ endedAt: null, user: (await User.findOne({ email: "scope.two@maslogcare.test" }))._id });
  check("scope all ends every recorded session", open === 0);

  const c = await signIn("scope.two@maslogcare.test", CHROME_LINUX);
  const fresh = await request("/sessions", { token: c });
  check("A new sign-in after scope all counts alone", fresh.status === 200 && fresh.body.count === 1, JSON.stringify(fresh.body));
}

(async () => {
  try {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-1234567890";
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    await run();
  } catch (error) {
    failed += 1;
    console.error("Test runner error:", error);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
  console.log(failed ? `\n${failed} failed` : "\nAll passed");
  process.exit(failed ? 1 : 0);
})();
