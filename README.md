# SUN REWARD — Telegram Mini App

SUN REWARD is an existing Telegram Mini App with a SQLite backend, Telegram `initData` authentication, referrals, task review, shop inventory, garden rewards, wallet association, withdrawals, and an admin console. This release extends that system in place; it does not replace the backend or delete `data.sqlite`.

## Implemented in this release

- Telegram Mini App HMAC authentication with session freshness validation.
- Existing profile, integer points compatibility, referrals, channel checks, garden, task review, shop, inventory, spin, TON wallet association, and withdrawal-review flows preserved.
- Fixed-point SUN balances: **1 SUN = 1,000,000 micro-SUN**. Tap rewards are exactly `0.001 SUN`; mining accrues `0.0001 SUN/second` for a maximum of two hours.
- Versioned, idempotent migrations in `migrations.js`; existing integer balances are backfilled as `old_points × 1,000,000` without rounding.
- Configurable SUN/USD rate, MMK/USD estimate, withdrawal minimum/maximum/daily limits, ticker, and VIP-required policy.
- Inbox notifications with unread count and read state.
- Ten VIP levels with price, reward, duration, withdrawal multiplier, and profile-frame identifiers.
- Piggy Bank deposit and withdrawal.
- Mining start/claim with server-side timing and a two-hour cap.
- Ten treasure-box levels with server-side randomized reward ranges and opening audit records.
- Gift-code creation (admin) and idempotent redemption (user).
- Daily, monthly, and yearly Top 100 leaderboards based on server-side reward events.
- Events/ticker API and a responsive Android-friendly dark navy/gold Rewards Lab UI.
- KBZPay and WavePay withdrawal methods with stored USD and MMK estimates. Approval remains manual; no payment is automatically sent.

## Database migration safety

Back up the production SQLite files before deployment:

```bash
cp data.sqlite data.sqlite.before-sun-reward-$(date +%Y%m%d%H%M%S).sqlite
cp data.sqlite-wal data.sqlite-wal.before-sun-reward-$(date +%Y%m%d%H%M%S) 2>/dev/null || true
cp data.sqlite-shm data.sqlite-shm.before-sun-reward-$(date +%Y%m%d%H%M%S) 2>/dev/null || true
```

On startup, the migration creates `schema_migrations`, adds micro-SUN columns, backfills old integer values, and creates feature tables. It is additive and rerunnable. Legacy integer updates are synchronized to micro-SUN while preserving any fractional remainder. Never delete `data.sqlite`, and never run tests against the production database.

The isolated migration test uses an in-memory SQLite database and verifies legacy balance conversion, idempotent reruns, ten VIP levels, ten treasure boxes, and fractional-unit preservation.

## Local setup

Requirements: Node.js 20+, npm, and a public HTTPS URL when running inside Telegram.

```bash
npm install
cp .env.example .env
# edit .env; never commit it
npm run check
npm test
npm start
```

Open the app from the Telegram bot. Ordinary browser sessions are intentionally rejected by protected user APIs unless they provide valid Telegram `initData`.

## Environment variables

Required production values are `BOT_TOKEN`, `BOT_USERNAME`, `ADMIN_KEY`, and usually `REQUIRED_CHANNEL`. Never place `BOT_TOKEN` or `ADMIN_KEY` in frontend code, screenshots, Git, or a public ZIP. `TON_CONNECT_MANIFEST_URL` may point to a public HTTPS manifest; the server fallback derives a manifest from the request host for development.

Reward-economy settings in `.env.example` include:

- `SUN_USD_RATE` — display conversion rate.
- `WITHDRAWAL_USD_PER_SUN` and `MMK_PER_USD` — payout estimates.
- `MIN_WITHDRAWAL_MICRO`, `MAX_WITHDRAWAL_MICRO`, and `DAILY_WITHDRAWAL_MICRO` — fixed-point limits.
- `VIP_REQUIRED_FOR_WITHDRAWAL` — `0` or `1`.
- `TICKER_TEXT` — default ticker text.

Admin API calls require `X-Admin-Key`; the key is never returned by the server. Configure notifications, gift codes, settings, and withdrawal policy only from a controlled admin environment.

## Render deployment runbook — review before production

This project is not deployed by this task. Before a production rollout:

1. Create and verify a database backup and a restore copy.
2. Confirm the Render service has persistent disk storage for `data.sqlite`; without persistent storage, user data will be lost on restart.
3. Set all required environment variables in Render's secret environment configuration.
4. Deploy the reviewed working branch through your normal change-control process, not by force-pushing `main`.
5. Check `/health`, then inspect migration version and `PRAGMA integrity_check` on the restored copy.
6. Open the Mini App from Telegram and test authentication, fractional tap, mining cap, inbox, withdrawal estimates, and admin review with a non-production test account.
7. Only after explicit approval should a production deployment be triggered.

## Tests and evidence

`npm run check` validates `server.js`, `app.js`, and `migrations.js`. `npm test` runs isolated authentication, migration/arithmetic, and withdrawal state-transition tests against in-memory/test-safe fixtures. A local runtime smoke test also verified `/health`, the dynamic TON manifest, the Rewards Lab HTML marker, migration version 2, the trigger, ten VIP levels, ten treasure boxes, and withdrawal columns.

## Honest limitations

- Withdrawal approval changes status and refund behavior only; it does not transfer KBZPay, WavePay, TON, USDT, or other funds.
- VIP purchase is an internal SUN debit; no paid checkout or external payment verification is included.
- “Manual” task verification remains manual because no external social-platform verification API was supplied.
- Telegram timestamp validation uses Unix seconds and rejected withdrawal refunds use the exact stored micro-SUN amount exactly once. The existing single-file SQLite architecture remains single-writer oriented. Multi-instance scaling and high-volume production use require a separately approved database migration and operational design.
- The admin surface still uses the existing shared `ADMIN_KEY` model. It is timing-safe but is not a full named-admin/RBAC/MFA system; hardening that model should precede high-value financial operations.
