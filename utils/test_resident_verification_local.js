"use strict";

const path = require("path");
const { spawn } = require("child_process");

const BACKEND = path.resolve(__dirname, "..");
const { MongoMemoryServer } = require("mongodb-memory-server");
const PORT = process.env.TEST_PORT || "5099";

const backendRequire = require("module").createRequire(path.join(BACKEND, "package.json"));

async function main() {
  console.log("Starting in-memory MongoDB…");
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri("maslogcare_test");
  console.log(`  mongod at ${uri}\n`);

  process.env.MONGO_URI = uri;
  process.env.PORT = PORT;
  process.env.NODE_ENV = "development";
  process.chdir(BACKEND);

  backendRequire("dotenv").config({ path: path.join(BACKEND, ".env") });
  process.env.MONGO_URI = uri;

  const { createApp } = backendRequire("./app");
  const connectDB = backendRequire("./config/db");
  const { seedAdmin } = backendRequire("./services/seedAdmin");

  await connectDB();
  await seedAdmin();
  console.log("Database connected and seeded.\n");

  const server = await new Promise((resolve) => {
    const s = createApp().listen(Number(PORT), "127.0.0.1", () => resolve(s));
  });
  console.log(`API listening on 127.0.0.1:${PORT}\n`);

  const code = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(BACKEND, "utils", "test_resident_verification_e2e.js")],
      {
        cwd: BACKEND,
        stdio: "inherit",
        env: { ...process.env, MONGO_URI: uri, TEST_BASE_URL: `http://127.0.0.1:${PORT}/api` },
      }
    );
    child.on("exit", resolve);
  });

  await new Promise((resolve) => server.close(resolve));
  await backendRequire("mongoose").disconnect().catch(() => {});
  await mongo.stop();
  process.exit(code ?? 1);
}

main().catch((error) => {
  console.error("Runner failed:", error);
  process.exit(1);
});
