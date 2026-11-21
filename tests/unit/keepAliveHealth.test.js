"use strict";
// An external scheduler (cron-job.org) requests GET /api/health every 10 minutes
// so Render Free is less likely to spin the service down. The route must stay
// cheap and public: no database, no auth, nothing internal in the body, and never
// cacheable, or a cached copy could answer without the request reaching Render.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { createApp } = require("../../app");

test("keep-alive liveness answers without the database, auth or caching", async () => {
  // No mongoose.connect() here: the database is deliberately unavailable.
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/health`;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await response.json(), { success: true, message: "Service is running", data: {} });

    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);

    // Readiness is the separate check that depends on the database.
    assert.equal((await fetch(url.replace("/health", "/ready"))).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
