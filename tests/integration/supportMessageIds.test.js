"use strict";

// Every support message must reach the client with a stable, unique `id` (the React list key),
// including tickets written by the earlier support backend that stored only a Mongo `_id`.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-support-message-ids";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { createApp } = require("../../app");
const { issueSession } = require("../../services/sessionService");
const { toTicket } = require("../../services/support/supportTicketSerializer");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const hasUniqueIds = (items) => {
  const ids = items.map((item) => item.id);
  return ids.every((id) => typeof id === "string" && id.length > 0) && new Set(ids).size === ids.length;
};

const legacyMessage = (overrides) => ({
  _id: new mongoose.Types.ObjectId(),
  author: new mongoose.Types.ObjectId(),
  authorRole: "resident",
  authorName: "Juan Resident",
  body: "Same text",
  isStaffReply: false,
  createdAt: new Date(),
  ...overrides,
});

function serializerChecks() {
  console.log("\nSerializer");

  const legacy = [
    legacyMessage({ body: "Same text", createdAt: new Date("2026-09-01T00:00:00Z") }),
    legacyMessage({ body: "Same text", createdAt: new Date("2026-09-01T00:00:00Z") }),
  ];
  const ticket = toTicket({
    _id: new mongoose.Types.ObjectId(),
    messages: [...legacy, { id: "uuid-1", body: "New", authorName: "A", authorRole: "admin" }],
    attachments: [{ _id: new mongoose.Types.ObjectId(), fileName: "a.png", mimeType: "image/png", fileSize: 1 }],
  });

  check("legacy messages fall back to their persistent _id", ticket.messages[0].id === String(legacy[0]._id));
  check("identical text + timestamp still get distinct ids", hasUniqueIds(ticket.messages));
  check("messages with an id keep it", ticket.messages[2].id === "uuid-1");
  check("legacy attachments get an id", hasUniqueIds(ticket.attachments));

  const again = toTicket({ _id: new mongoose.Types.ObjectId(), messages: legacy, attachments: [] });
  check(
    "ids are identical across repeated serialization (stable on refresh)",
    again.messages.every((message, index) => message.id === ticket.messages[index].id)
  );
}

async function apiChecks() {
  console.log("\nAdmin API with a legacy-shaped ticket");

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const server = createApp().listen(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  try {
    const { insertedId: adminId } = await mongoose.connection.collection("users").insertOne({
      fullname: "Ana Admin",
      email: "admin@support.test",
      role: "admin",
      verified: true,
      status: "active",
    });
    const { token } = issueSession({ _id: adminId, email: "admin@support.test", role: "admin" }, "web");

    const legacy = [
      legacyMessage({ authorRole: "admin", authorName: "Ana Admin", isStaffReply: true, body: "Hi" }),
      legacyMessage({ body: "Same text" }),
      legacyMessage({ body: "Same text" }),
    ];
    const { insertedId: ticketId } = await mongoose.connection.collection("supporttickets").insertOne({
      ticketNumber: "TKT-LEGACY-0001",
      requester: new mongoose.Types.ObjectId(),
      requesterName: "Juan Resident",
      requesterRole: "resident",
      contactEmail: "juan@support.test",
      contactNumber: "",
      category: "other",
      subject: "Legacy ticket",
      description: "Created by the earlier support backend.",
      status: "open",
      attachments: [],
      messages: legacy,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const request = async (method, path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Client-Platform": "web",
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    };

    const first = await request("GET", `/admin/support/tickets/${ticketId}`);
    const messages = first.body.ticket?.messages ?? [];
    check("ticket loads", first.status === 200, `status ${first.status}`);
    check("every legacy message has a unique id", hasUniqueIds(messages), JSON.stringify(messages.map((m) => m.id)));
    check(
      "message order is preserved",
      messages.map((m) => m.id).join() === legacy.map((m) => String(m._id)).join()
    );

    const reply = await request("POST", `/admin/support/tickets/${ticketId}/messages`, { body: "Follow-up" });
    check("admin can reply to a legacy ticket", reply.status === 201, `status ${reply.status}`);

    const second = await request("GET", `/admin/support/tickets/${ticketId}`);
    const after = second.body.ticket?.messages ?? [];
    check("reply is appended last with the id returned by the API", after.at(-1)?.id === reply.body.message?.id);
    check("all ids stay unique after the insert", hasUniqueIds(after));
    check(
      "existing ids are unchanged after a refetch",
      messages.every((message, index) => after[index]?.id === message.id)
    );
  } finally {
    server.close();
    await mongoose.disconnect();
    await mongod.stop();
  }
}

(async () => {
  serializerChecks();
  await apiChecks();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
