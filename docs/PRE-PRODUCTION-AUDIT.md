# SUN REWARD pre-production audit

This audit started from the exact `SUN-REWARD-FINAL-VERIFIED.zip` archive. Work was performed on the local-only branch `audit/pre-production-20261101`. No production database, Render service, GitHub repository, or production credentials were accessed.

## Verified fixes applied

The financial input boundary now parses decimal SUN strings exactly into integer micro-SUN units using `BigInt`; values with non-zero precision beyond six decimal places are rejected. Withdrawal and Piggy Bank UI inputs now send the original input strings instead of converting them through JavaScript `Number`. Legacy withdrawal fallback input is parsed without floating arithmetic.

Migrated micro columns are kept synchronized for referral rewards, seeded and administered shop prices, and administered task rewards. Reward leaderboard events are recorded only for positive reward credits, not debits such as purchases, VIP activation, Piggy Bank deposits, or withdrawals. The user-facing rejected-withdrawal message now says exact SUN was refunded.

## Test commands and actual results

`npm ci --no-audit --no-fund` completed successfully and built the native `better-sqlite3` binding. `npm run check` passed. `npm test` passed four suites and four tests files: exact decimal amount parsing, Telegram authentication, SQLite migration/fractional arithmetic, and withdrawal approval/rejection/refund idempotency. Total result: 4 passed, 0 failed.

A runtime smoke test started the server on a temporary port and SQLite file, verified `/health`, verified the Rewards Lab HTML marker, and confirmed migration version 2, `users.sun_micro`, `ledger.delta_micro`, `shop_items.cost_micro`, `managed_tasks.reward_micro`, `referral_rewards.reward_micro`, ten VIP levels, and ten treasure boxes. Temporary database files were deleted.

The exact archive was tested with `unzip -t` before extraction. The final archive was extracted into a fresh temporary directory and checked for required files and prohibited artifacts.

## Implemented and verified internally

Telegram HMAC authentication, timestamp freshness checks, profile loading, referrals, daily check-in, tap rewards, server-timed mining, exact micro-SUN ledger credits/debits, Piggy Bank, VIP levels, treasure boxes, gift-code redemption, inbox, events/ticker, shop, tasks, plant/garden, spin, leaderboards, wallet association, withdrawal policy checks, manual withdrawal approval/rejection, and admin-protected CRUD routes are present and connected to backend APIs.

## Partial or externally dependent

Withdrawal approval is only an internal state transition and exact accounting operation; it does not send KBZPay, WavePay, TON, USDT, or other funds. Social task completion remains manual. The shared `ADMIN_KEY` model is server-enforced and rate-limited but is not named-admin RBAC/MFA. The UI is a compact existing admin console, not a full separate multi-section admin product. SQLite remains single-writer oriented and requires persistent Render disk storage.

The legacy integer `points` columns remain for backward compatibility and display. The financial source of truth for new operations is `sun_micro`; compatibility columns are not used for new reward balance mutations. Existing integer task/shop/referral configuration remains integer SUN-granularity even though all resulting credits are converted exactly to micro-SUN.

## Staging recommendation

The ZIP is suitable for isolated staging deployment after a database backup/restore rehearsal, environment-variable review, persistent-disk confirmation, and non-production Telegram test account verification. It is not a production deployment approval. External payout transfer, full admin RBAC/MFA, and provider-backed social verification must be resolved before treating it as fully production-ready for financial operations.
