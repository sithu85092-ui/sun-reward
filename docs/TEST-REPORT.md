# Actual test report

Executed in the isolated local project directory on 2026-11-01. No production credentials, Render deployment, GitHub push, or production database was used.

`npm ci --no-audit --no-fund` completed successfully and built the native `better-sqlite3` binding. An initial `npm ci --ignore-scripts` run was intentionally not counted as a pass because the native binding was absent; the prescribed lifecycle-enabled install was then run successfully.

`npm run check` passed for `server.js`, `app.js`, `migrations.js`, `auth.js`, and `withdrawals.js` through the configured check command. `npm test` passed all three test files: authentication timestamp/signature cases, migration and exact micro-unit cases, and withdrawal approval/rejection with exact refund and duplicate-transition protection.

The runtime smoke test started the server against a temporary local SQLite file and verified `/health`, the Rewards Lab HTML marker, migration version 2, the `sun_micro` column, ten VIP levels, ten treasure boxes, and micro withdrawal-policy columns. Temporary SQLite files were deleted after the test.

The final ZIP was created without `.git`, `node_modules`, `.env`, or SQLite files and extracted into a fresh temporary directory for content verification. Production remains untouched.
