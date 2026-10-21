# MaslogCare API

The Express 5 + MongoDB (Mongoose) REST API behind the MaslogCare app. It handles authentication and resident verification, appointments and the triage queue, medical missions, medical records, inventory, notifications, support tickets and system logs.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in MONGO_URI, JWT_SECRET (32+ chars) and email settings
npm run dev            # nodemon on PORT (default 3000)
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

Scripts in `tests/live/` **write to the database in `MONGO_URI`**, and the `*.e2e.js` ones also call a running server (`TEST_BASE_URL`, default `http://127.0.0.1:3000/api`). Run them one at a time with `node tests/live/<file>`, and only against a development database.

## Deploying on Render

Start command `npm start`, health check path `/api/health`. Render sets
`NODE_ENV=production` itself. Set these in the service's Environment tab:

| Variable | Value |
| --- | --- |
| `MONGO_URI`, `JWT_SECRET`, email settings | As in `.env.example`. Secrets live only here |
| `CLIENT_ORIGINS` | Every address the web app is served from, comma separated, e.g. `https://maslogcare.com`. Full origins only: the server refuses to start on an entry without `https://` |
| `TRUST_PROXY` | The number of proxies in front of the app, so sign-in and OTP limits see each visitor's address. Until it is set, the server logs a warning and every visitor shares one limit |

REST and Socket.IO accept the same origins. Without `NODE_ENV=production`
(local development), any localhost or private-network origin is also accepted,
so Expo's changing web port and Wi-Fi address keep working.

## Security notes

- `.env` and everything in `storage/` are git-ignored. Never commit them. Uploaded IDs are personal data.
- If a real `.env` was ever committed, rotate `JWT_SECRET`, the MongoDB password, the SMTP password and the admin password.

## Master resident duplicate protection

The official admin resident list compares **all** of first name, middle name,
last name, suffix, birth date, sex, civil status, barangay, and address. Text is
trimmed and lowercased for comparison only. Optional absent middle names and
suffixes equal empty strings. Punctuation, internal whitespace, and leading
zeros remain significant. Official display values are preserved. This is an
exact record comparison, not a claim that names identify a person. A changed
address or civil status is a different combination. Prefer editing an existing
resident when updating their details.

Uniqueness spans the single registry, including inactive records. Account and
resident active status do not participate. Existing master resident ID
uniqueness also remains. Add, edits and imports use the same derived SHA-256
comparison key and MongoDB unique index. Concurrent conflicts return HTTP 409
`DUPLICATE_RESOURCE` with safe field errors consumed by the existing web/mobile
wizard, which preserves input and releases its submission lock on failure.

The backend now runs this repeatable backfill and unique-index preparation
before accepting HTTP requests. A clean legacy database is upgraded automatically;
conflicting or incomplete records block startup without changing them. Only
derived comparison keys are backfilled, never resident details or accounts.

**Before deploying against an existing database:** stop all master-list writers
(including old application instances), take a backup, then run from `backend/`:

```bash
node scripts/migrations/masterResidentIdentity.js          # read-only audit
node scripts/migrations/masterResidentIdentity.js --apply  # backfill and index
```

The audit prints counts only. Conflicting or incomplete legacy records block
apply without writing anything. Review those records privately and obtain
explicit authorization for any correction; this migration never removes or
merges records. Re-run the audit and apply after resolving blockers. Keep writes
stopped through successful index creation, then deploy/restart. Apply is
rerunnable after an interrupted backfill. Runtime saves fail closed when the
index or legacy backfill is missing. Do not drop the unique index while serving
writes or bypass the services with raw database updates.

Imports use a MongoDB transaction to retain all-or-nothing behavior even when
another writer wins a uniqueness race. **A replica set or sharded cluster is
required for imports** (Atlas supports this); standalone MongoDB cannot execute
these transactions. Single-record Add does not require a transaction. No live
database audit or migration is performed by the test suite.


## Master List resident roles

`master_residents.role` classifies an official record as `resident`, `bhw`, or
`midwife` (shown as Resident, BHW, Midwife). Admin create, edit and import routes
validate the same values; invalid explicit values return a role field error.
Omitting the field on create defaults to Resident; omitting it on PATCH keeps
the current role. Reads treat missing, null or empty legacy roles as Resident.
The field never changes `users.role`, account approval, or login permissions.
Search accepts the displayed role labels alongside names and record IDs.
The app offers Role, Civil Status (Single, Married, Widowed, Separated), and
Purok filters. They combine with search before pagination, reset to page one
when changed, and are saved separately from account-list filters. Defaults
include all roles, civil statuses, puroks, and active/inactive records.

The list API accepts `role=all|resident|bhw|midwife`,
`civilStatus=all|single|married|widowed|separated`, and `purok=all` or an exact
Purok choice from the resident form. Invalid/repeated values return HTTP 400.
Purok filtering reads the existing address field; no new database field or
migration is needed. Unique purok numbers also match legacy addresses beginning
with that purok, without confusing Purok 1 with Purok 10. The two Purok 2 areas
require their named area (Pangulo or Pangulo 2); ambiguous legacy addresses stay
visible under All puroks and are never automatically reassigned.

Existing API clients may still send `status=all|active|inactive` and
`sort=name_asc|name_desc|newest|oldest`. Omitting status retains the API's active
record default; the app explicitly requests all. Default ordering is by name;
newest/oldest use creation date. Every order uses a stable ID tie-breaker.
Legacy unassigned roles belong to the Resident filter.

Deploy the API before the client so the editor can save the new classifications.
MongoDB needs no new collection or index. Existing records work immediately via
the read fallback. An optional, repeatable backfill persists the legacy default:

```bash
# From backend/, using the intended database's MONGO_URI
node scripts/migrations/masterResidentRoles.js          # read-only counts
node scripts/migrations/masterResidentRoles.js --apply  # set unassigned roles to resident
```

Take the usual database backup before applying. The update matches only missing,
null or empty roles, preserves assigned BHW/Midwife roles, does not touch account
records or resident timestamps, and is safe to rerun. No live database was
migrated by development or the test suite.
