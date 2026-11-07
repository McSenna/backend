"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { createApp } = require("../../app");

test("disconnected database rejects login promptly while liveness stays available", async () => {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
    const started = performance.now();
    const response = await fetch(`${url}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "synthetic@example.test", password: "SyntheticOnly123" }),
    });
    const elapsed = performance.now() - started;
    console.info(JSON.stringify({ scenario: "disconnected_login", durationMs: Math.round(elapsed), status: response.status }));
    assert.equal(response.status, 503);
    assert.ok(elapsed < 500, `unavailable database held login for ${elapsed}ms`);
    assert.equal((await response.json()).code, "DATABASE_ERROR");
    assert.ok(response.headers.get("x-request-id"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
