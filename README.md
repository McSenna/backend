# MaslogCare API

The Express 5 + MongoDB (Mongoose) REST API behind the MaslogCare app. It handles authentication and resident verification, appointments and the triage queue, medical missions, medical records, inventory, notifications, support tickets and system logs.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in MONGO_URI, JWT_SECRET (32+ chars) and email settings
npm run dev            # nodemon on PORT (default 5000)
```

On first boot the server validates its configuration, connects to MongoDB and seeds the default admin account (`ADMIN_DEFAULT_PASSWORD`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` / `npm run dev` | Start the server (plain / with nodemon) |
| `npm test` | Unit + integration tests. They need no database: integration tests use `mongodb-memory-server` |
| `npm run test:unit` / `npm run test:integration` | Run one group |
| `npm run seed:inventory` | Seed sample inventory into the database in `MONGO_URI` |

## Layout

```
server.js / app.js    Bootstrap (env check, DB, admin seed) and Express app factory
routes/               Route tables → controllers
controllers/<area>/   HTTP handlers; <area>Controller.js re-exports the folder
services/<area>/      Business logic; <area>Service.js is the public entry when one exists
models/               Mongoose schemas (sub-folders hold field groups and hooks)
middleware/           auth, role checks, platform access, rate limiting, error handling
config/               env validation, CORS, domain constants
utils/                Small pure helpers (errors, validation, dates, logging)
scripts/              CLI scripts (seeding, test runner)
tests/
  unit/               Pure logic, no I/O
  integration/        Full HTTP flows against an in-memory MongoDB
  live/               Need a real database and/or a running server — see below
storage/              Uploaded ID documents and attachments (git-ignored, created with 0700)
```

### Live tests

Scripts in `tests/live/` **write to the database in `MONGO_URI`**, and the `*.e2e.js` ones also call a running server (`TEST_BASE_URL`, default `http://127.0.0.1:5000/api`). Run them one at a time with `node tests/live/<file>`, and only against a development database.

## Security notes

- `.env` and everything in `storage/` are git-ignored. Never commit them. Uploaded IDs are personal data.
- If a real `.env` was ever committed, rotate `JWT_SECRET`, the MongoDB password, the SMTP password and the admin password.
