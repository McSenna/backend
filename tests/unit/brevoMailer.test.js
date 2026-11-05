"use strict";

// fetch is replaced in every test, so no request reaches Brevo and no email is
// sent. Every address and key here is invented.

const assert = require("node:assert/strict");

const API_KEY = "test-brevo-key-do-not-log";
const SENDER = "sender@maslogcare.test";
const TO = "resident.person@maslogcare.test";
const CODE = "482913";
const RESET_URL = "https://maslogcare.test/reset?token=abc123";

const mailer = require("../../services/mailer");

const configure = (overrides = {}) => {
  delete process.env.NODE_ENV;
  Object.assign(process.env, {
    EMAIL_ENABLED: "true",
    EMAIL_PROVIDER: "brevo",
    BREVO_API_KEY: API_KEY,
    BREVO_SENDER_EMAIL: SENDER,
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

let calls = [];
const respondWith = (status, body, headers = {}) => {
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers });
  };
};
const accept = () => respondWith(201, { messageId: "<id@relay.test>" });
const throwOnFetch = (error) => {
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    throw error;
  };
};

// Captured so tests can check nothing sensitive is printed.
let logged = [];
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
const capture = () => {
  logged = [];
  for (const level of ["log", "warn", "error"]) {
    console[level] = (...args) => logged.push(args.join(" "));
  }
};
const release = () => {
  console.log = realLog;
  console.warn = realWarn;
  console.error = realError;
};

const send = () => mailer.sendMail({ to: TO, subject: "A subject", text: "A body" });
const failure = (promise) => promise.then(() => assert.fail("expected a failure"), (error) => error);

const SENDERS = {
  sendOTPEmail: {
    run: () => mailer.sendOTPEmail(TO, CODE, "Test Resident"),
    subject: "MaslogCare – Your Verification Code",
    contains: [CODE, "5 minutes", "Test Resident"],
  },
  sendPasswordResetCodeEmail: {
    run: () => mailer.sendPasswordResetCodeEmail(TO, CODE, "Test Resident"),
    subject: "MaslogCare – Password Reset Code",
    contains: [CODE, "10 minutes"],
  },
  sendPasswordResetEmail: {
    run: () => mailer.sendPasswordResetEmail(TO, "Test Resident", RESET_URL),
    subject: "MaslogCare – Password Reset Request",
    contains: [RESET_URL, "15 minutes"],
  },
  sendPasswordChangedEmail: {
    run: () => mailer.sendPasswordChangedEmail({ email: TO, fullname: "Test Resident", changedAt: new Date("2026-01-02T03:04:00Z") }),
    subject: "Your MaslogCare Password Has Been Changed",
    contains: ["re***@maslogcare.test", "January 2, 2026"],
  },
  sendWelcomeEmail: {
    run: () => mailer.sendWelcomeEmail(TO, "Test Resident"),
    subject: "Welcome to MaslogCare – Account Activated",
    contains: ["Test Resident", "verified"],
  },
  sendNotificationEmail: {
    run: () => mailer.sendNotificationEmail(TO, "Test Resident"),
    subject: "MaslogCare – Health Notification",
    contains: ["healthcare update"],
  },
};

const VISIT = { date: "Jan 5", time: "9:00 AM", worker: "Dr. Test", location: "Test Center", appointmentType: "Check-up" };
const appointmentCase = (name, subject, extraDetails, contains) => ({
  run: () => mailer[name](TO, "Test Resident", { ...VISIT, ...extraDetails }),
  subject,
  contains: ["Jan 5", "9:00 AM", "Dr. Test", "Test Center", "Check-up", "Test Resident", ...contains],
});
SENDERS.sendAppointmentConfirmationEmail = appointmentCase("sendAppointmentConfirmationEmail", "MaslogCare – Your Appointment is Confirmed", {}, ["confirmed", "10 minutes early"]);
SENDERS.sendAppointmentRescheduledEmail = appointmentCase("sendAppointmentRescheduledEmail", "MaslogCare – Appointment Rescheduled", {}, ["rescheduled"]);
SENDERS.sendAppointmentDeclinedEmail = appointmentCase("sendAppointmentDeclinedEmail", "MaslogCare – Appointment Update", { declineReason: "Slot closed" }, ["declined", "Reason: Slot closed"]);
SENDERS.sendAppointmentReminderEmail = appointmentCase("sendAppointmentReminderEmail", "MaslogCare – Reminder: Appointment Tomorrow", {}, ["tomorrow", "10 minutes early"]);

const tests = {
  "maps a send to Brevo's request": async () => {
    configure();
    accept();
    const result = await send();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["api-key"], API_KEY);
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.ok(calls[0].init.signal, "the request has a timeout");
    assert.deepEqual(calls[0].body, {
      sender: { name: "MaslogCare", email: SENDER },
      to: [{ email: TO }],
      subject: "A subject",
      textContent: "A body",
    });
    assert.equal(result.messageId, "<id@relay.test>");
  },

  "ignores any html or attachments passed in": async () => {
    configure();
    accept();
    await mailer.sendMail({ to: TO, subject: "S", text: "T", html: "<b>no</b>", attachments: [{ path: "x" }] });
    assert.equal(calls[0].body.htmlContent, undefined);
    assert.equal(calls[0].body.attachment, undefined);
  },

  "still counts as accepted when the 201 body is unreadable": async () => {
    configure();
    global.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return new Response("not json", { status: 201 });
    };
    assert.deepEqual(await send(), { messageId: undefined });
  },

  "fails clearly without an API key, and sends nothing": async () => {
    configure({ BREVO_API_KEY: undefined });
    accept();
    const error = await failure(send());
    assert.equal(error.code, "EMAIL_CONFIGURATION_ERROR");
    assert.equal(calls.length, 0);
  },

  "fails clearly without a sender address, and sends nothing": async () => {
    configure({ BREVO_SENDER_EMAIL: undefined });
    accept();
    const error = await failure(send());
    assert.equal(error.code, "EMAIL_CONFIGURATION_ERROR");
    assert.equal(calls.length, 0);
  },

  "sends nothing when email is off or mocked": async () => {
    accept();
    configure({ EMAIL_ENABLED: "false" });
    assert.equal((await send()).mock, true);
    configure({ EMAIL_PROVIDER: "mock" });
    assert.equal((await send()).mock, true);
    assert.equal(calls.length, 0);
  },

  "maps a 401 to an authentication failure": async () => {
    configure();
    respondWith(401, { code: "unauthorized", message: "Key not found" });
    assert.equal((await failure(send())).code, "EMAIL_AUTH_FAILED");
  },

  "maps a 402 to the quota error": async () => {
    configure();
    respondWith(402, { code: "not_enough_credits", message: "Not enough credits" });
    assert.equal((await failure(send())).code, "EMAIL_QUOTA_EXCEEDED");
  },

  "maps a 429 to rate limited, with the wait from Brevo's header": async () => {
    configure();
    respondWith(429, {}, { "x-sib-ratelimit-reset": "45" });
    const error = await failure(send());
    assert.equal(error.code, "EMAIL_RATE_LIMITED");
    assert.equal(error.httpStatus, 429);
    assert.deepEqual(error.details, { retryAfter: 45 });
  },

  "maps an invalid recipient to a 400 recipient error": async () => {
    configure();
    respondWith(400, { code: "invalid_parameter", message: "email is not valid in to" });
    const error = await failure(send());
    assert.equal(error.code, "EMAIL_RECIPIENT_INVALID");
    assert.equal(error.httpStatus, 400);
  },

  "maps an unaccepted sender to a configuration error, not a recipient error": async () => {
    configure();
    respondWith(400, { code: "invalid_parameter", message: "Sender email is not valid" });
    assert.equal((await failure(send())).code, "EMAIL_CONFIGURATION_ERROR");
  },

  "maps a provider outage to a 503": async () => {
    configure();
    respondWith(500, { message: "oops" });
    const error = await failure(send());
    assert.equal(error.code, "EMAIL_UNKNOWN_ERROR");
    assert.equal(error.httpStatus, 503);
  },

  "maps a network failure and a timeout, tried once each": async () => {
    configure();
    throwOnFetch(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }));
    const network = await failure(send());
    assert.equal(network.code, "EMAIL_NETWORK_ERROR");
    assert.match(network.message, /ECONNRESET/);
    assert.equal(calls.length, 1);

    calls = [];
    throwOnFetch(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const timeout = await failure(send());
    assert.equal(timeout.code, "EMAIL_NETWORK_ERROR");
    assert.match(timeout.message, /timed out/);
    assert.equal(calls.length, 1, "a timeout is not retried, so it can't send twice");
  },

  "never retries a rate limit": async () => {
    configure();
    respondWith(429, {});
    await failure(send());
    assert.equal(calls.length, 1);
  },

  "does not copy Brevo's message text into errors": async () => {
    configure();
    respondWith(400, { code: "invalid_parameter", message: `email ${TO} is not valid` });
    const error = await failure(send());
    assert.ok(!error.message.includes(TO));
  },

  "logs no key, body, code, link or full address": async () => {
    configure();
    accept();
    capture();
    try {
      for (const { run } of Object.values(SENDERS)) await run();
      respondWith(401, { code: "unauthorized", message: `bad ${TO}` });
      await failure(mailer.sendOTPEmail(TO, CODE, "Test Resident"));
    } finally {
      release();
    }
    const output = logged.join("\n");
    assert.ok(output.length > 0, "something was logged");
    for (const secret of [API_KEY, CODE, RESET_URL, TO, "Test Resident"]) {
      assert.ok(!output.includes(secret), `the log must not contain ${secret}`);
    }
  },

  "skips optional notices quietly without settings, without printing the address": async () => {
    configure({ BREVO_API_KEY: undefined });
    accept();
    capture();
    try {
      await mailer.sendWelcomeEmail(TO, "Test Resident");
      await mailer.sendAppointmentConfirmationEmail(TO, "Test Resident", VISIT);
    } finally {
      release();
    }
    assert.equal(calls.length, 0);
    assert.ok(!logged.join("\n").includes(TO));
  },

  "welcome and notification failures do not reach the caller": async () => {
    configure();
    respondWith(500, {});
    await mailer.sendWelcomeEmail(TO, "Test Resident");
    await mailer.sendNotificationEmail(TO, "Test Resident");
  },

  "appointment failures reach the caller without the address": async () => {
    configure();
    respondWith(500, {});
    const error = await failure(mailer.sendAppointmentConfirmationEmail(TO, "Test Resident", VISIT));
    assert.match(error.message, /Failed to send appointment confirmation email/);
    assert.ok(!error.message.includes(TO));
  },

  "falls back to a generic line when a visit has no type or location": async () => {
    configure();
    accept();
    await mailer.sendAppointmentDeclinedEmail(TO, "Test Resident", { date: "Date TBD", time: "Time TBD" });
    const { textContent } = calls[0].body;
    assert.match(textContent, /Your MaslogCare appointment request has been declined/);
    assert.match(textContent, /Doctor: Medical mission team/);
    assert.doesNotMatch(textContent, /undefined|null|Location:|Reason:/);
  },

  "uses the patient's name when the visit is for someone else": async () => {
    configure();
    accept();
    await mailer.sendAppointmentConfirmationEmail(TO, "Test Resident", { ...VISIT, patientName: "Test Child" });
    assert.match(calls[0].body.textContent, /Patient: Test Child/);
  },
};

for (const [name, { run, subject, contains }] of Object.entries(SENDERS)) {
  tests[`${name} sends plain text as MaslogCare with its details`] = async () => {
    configure();
    accept();
    await run();

    assert.equal(calls.length, 1);
    const { body } = calls[0];
    assert.deepEqual(body.sender, { name: "MaslogCare", email: SENDER });
    assert.deepEqual(body.to, [{ email: TO }]);
    assert.equal(body.subject, subject);
    assert.deepEqual(Object.keys(body).sort(), ["sender", "subject", "textContent", "to"], "only the plain text body is sent");
    assert.doesNotMatch(body.textContent, /<[a-z/!][^>]*>|&[a-z]+;|style=|cid:/i, "no markup in the text");
    assert.doesNotMatch(body.textContent, /undefined|null|\[object/, "no missing values in the text");
    for (const expected of contains) {
      assert.ok(body.textContent.includes(expected), `${name} must include "${expected}"`);
    }
  };
}

(async () => {
  let failed = 0;
  for (const [name, test] of Object.entries(tests)) {
    calls = [];
    capture();
    try {
      await test();
      release();
      console.log(`  PASS  ${name}`);
    } catch (error) {
      release();
      failed += 1;
      console.log(`  FAIL  ${name}: ${error.message}`);
    }
  }
  console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} Brevo mailer tests passed`);
  process.exit(failed > 0 ? 1 : 0);
})();
