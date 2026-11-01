# SUN REWARD staging readiness report

## Source and safety

This execution started from the exact uploaded `SUN-REWARD-PRE-PRODUCTION-VERIFIED.zip`. The archive was integrity-tested and extracted into `/home/ubuntu/sun-reward-staging-audit`. No production database, Render service, GitHub repository, production bot token, payment credential, or production environment variable was used.

The local audit branch is `staging/readiness-20261101`. A disposable SQLite path was used for runtime testing through `DB_PATH=/tmp/sun-reward-dbpath-test.sqlite`, and all temporary database files were removed afterward.

## Commands executed

Dependency installation:

```text
npm ci --no-audit --no-fund
npm warn deprecated prebuild-install@7.1.3: No longer maintained. Please contact the author of the relevant native addon.
added 107 packages in 858ms
npm_ci_exit=0
```

Syntax check:

```text
npm run check
> sun-reward@1.1.0 check
> node --check server.js && node --check app.js && node --check migrations.js
npm_run_check_exit=0
```

Test suite:

```text
npm test
1..5
# tests 5
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
npm_test_exit=0
```

The five passing test files are `test/amounts.test.js`, `test/auth.test.js`, `test/migrations.test.js`, `test/staging-integrity.test.js`, and `test/withdrawals.test.js`.

Runtime smoke test:

```text
{"ok":true,"app":"SUN REWARD"}
db_path_isolated=yes
SUN REWARD listening on port 3215
```

The smoke test also verified the Rewards Lab HTML marker, migration version 2, micro-SUN columns, ten VIP levels, ten treasure boxes, and no project-local SQLite file when `DB_PATH` pointed to `/tmp`.

## Bugs found and fixed

The uploaded source converted decimal financial input through JavaScript `Number` and `Math.round`. This was a confirmed precision risk. It was replaced with exact decimal-string parsing backed by `BigInt`, and withdrawal/Piggy Bank UI payloads now preserve the original string input.

The uploaded source hardcoded `data.sqlite`, preventing clean staging isolation. It now accepts `DB_PATH`, defaulting to the previous local path for backward compatibility.

Migrated micro columns were not synchronized when admins created or edited shop items and task rewards, and referral rows did not populate `reward_micro`. Those writes now populate the corresponding exact micro columns.

Leaderboard events were being recorded for negative balance operations as well as positive rewards. They now record positive reward credits only.

No dependency or environment failure remained. The first log-wrapper attempt incorrectly captured an empty pipeline status even though npm had succeeded; the command was rerun without the wrapper and recorded `npm_ci_exit=0`. This was a test harness issue, not an application defect.

## Coverage

The disposable migration tests cover legacy integer balances, fractional micro-SUN balances, idempotent migration, and rollback after a forced migration failure. Decimal tests cover exact `0.001 SUN`, six-decimal values, exponent input, zero-padding, precision rejection, negative values, invalid input, and overflow. Withdrawal tests cover approval, rejection, exact refund, duplicate review prevention, and rollback when the refund callback fails. Authentication tests cover valid, expired, future, invalid-signature, and missing-date cases.

Static API review confirmed that frontend calls map to backend routes for profile, tasks, social links, shop, wallet, tap, check-in, plant, spin, withdrawals, inbox, economy, VIP, Piggy Bank, mining, treasure boxes, gift codes, leaderboards, events, and admin operations. The final UI wording also identifies rejected withdrawals as exact SUN refunds.

## Staging setup

Extract the ZIP into a clean directory, run `npm ci`, copy `.env.staging.example` to `.env`, and replace all staging placeholders with staging-only values. Set `DB_PATH=./data.staging.sqlite` or an absolute staging path. Run `npm run check` and `npm test`, then start with `npm start`. Confirm `/health` before opening the Mini App from a staging Telegram bot.

Never point `DB_PATH` at the production database. Never reuse production bot tokens or payment credentials. Render staging must use a separate service and persistent disk if deployed later; this execution did not deploy anything.

## Readiness decision

The project is **ready for isolated staging tests**, not approved for production deployment. External payouts remain manual/internal, the shared admin-key model is not full RBAC/MFA, social verification is manual, and SQLite remains single-writer oriented. These limitations are documented rather than represented as completed functionality.
