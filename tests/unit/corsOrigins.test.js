"use strict";

// REST and Socket.IO share one origin rule. Every origin here is invented.
const { buildCorsOptions, isAllowedBrowserOrigin } = require("../../config/cors");
const { parseOrigins } = require("../../utils/origins");
const { isAllowedOrigin } = require("../../realtime/socketCors");
const { validateEnv } = require("../../config/env");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const restAllows = (origin) =>
  new Promise((resolve) => buildCorsOptions().origin(origin, (_err, allowed) => resolve(allowed)));

async function main() {
  console.log("\nConfigured origins are normalized like the browser's Origin header");
  const parsed = parseOrigins(" https://maslogcare.com/ ,HTTPS://App.Example.test,maslogcare.com,*,,");
  check("a trailing slash and upper case still match", parsed.valid.join() === "https://maslogcare.com,https://app.example.test", parsed.valid.join());
  check("entries without a scheme and wildcards are reported", parsed.invalid.join() === "maslogcare.com,*", parsed.invalid.join());

  const production = { NODE_ENV: "production", CLIENT_ORIGINS: "https://maslogcare.com/,https://maslogcare.example.workers.dev" };
  await withEnv(production, async () => {
    console.log("\nProduction allows only the listed frontends");
    check("the custom domain is allowed despite the trailing slash", isAllowedBrowserOrigin("https://maslogcare.com"));
    check("a second listed origin is allowed", isAllowedBrowserOrigin("https://maslogcare.example.workers.dev"));
    check("an unlisted site is refused", !isAllowedBrowserOrigin("https://evil.example"));
    check("the http version of a listed origin is refused", !isAllowedBrowserOrigin("http://maslogcare.com"));
    check("a local dev server is refused", !isAllowedBrowserOrigin("http://localhost:8081"));
    check("an opaque origin is refused", !isAllowedBrowserOrigin("null"));
    check("REST answers a listed origin", (await restAllows("https://maslogcare.com")) === true);
    check("REST refuses an unlisted origin", (await restAllows("https://evil.example")) === false);
    check("REST serves clients that send no Origin (native apps, curl)", (await restAllows(undefined)) === true);

    const socket = (origin, host = "api.example.test") => isAllowedOrigin({ headers: { origin, host } });
    check("a socket from a listed origin is allowed", socket("https://maslogcare.com"));
    check("a socket from an unlisted origin is refused", !socket("https://evil.example"));
    check("a socket with React Native's API-host Origin is allowed", socket("http://api.example.test"));
    check("a socket without an Origin is allowed", isAllowedOrigin({ headers: {} }));
  });

  await withEnv({ NODE_ENV: "development", CLIENT_ORIGINS: "" }, async () => {
    console.log("\nDevelopment allows local dev servers on any port, and nothing else");
    for (const origin of ["http://localhost:8081", "http://127.0.0.1:19006", "http://192.168.8.43:8081", "http://10.0.2.2:8081", "http://172.20.10.2:8082"]) {
      check(`${origin} is allowed`, isAllowedBrowserOrigin(origin));
    }
    check("a public site is refused", !isAllowedBrowserOrigin("https://evil.example"));
    check("a public address that looks private is refused", !isAllowedBrowserOrigin("http://172.32.0.1:8081"));
    check("REST refuses a public site in development too", (await restAllows("https://evil.example")) === false);
  });

  await withEnv({ NODE_ENV: "development", CLIENT_ORIGINS: "https://preview.example.test" }, async () => {
    check("a listed hosted origin is allowed in development", isAllowedBrowserOrigin("https://preview.example.test"));
  });

  console.log("\nStartup rejects an origin list the browser could never match");
  const base = { MONGO_URI: "mongodb://localhost:27017/test", JWT_SECRET: "x".repeat(40) };
  let refused = false;
  await withEnv({ ...base, NODE_ENV: "production", CLIENT_ORIGINS: "maslogcare.com" }, () => {
    try {
      validateEnv();
    } catch {
      refused = true;
    }
  });
  check("production refuses to start with an origin missing its scheme", refused);
  let started = true;
  await withEnv({ ...base, NODE_ENV: "production", CLIENT_ORIGINS: "https://maslogcare.com/" }, () => {
    try {
      validateEnv();
    } catch {
      started = false;
    }
  });
  check("production starts with a valid origin list", started);

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
