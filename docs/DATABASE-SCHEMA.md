# Database and micro-SUN architecture

SUN balances use SQLite `INTEGER` micro-units. One SUN equals 1,000,000 micro-SUN. JavaScript converts only at validated API boundaries; storage and arithmetic remain integer-based. The tap reward is 1,000 micro-SUN (`0.001 SUN`) and mining earns 100 micro-SUN per second (`0.0001 SUN`).

Migration version 1 adds `users.sun_micro`, `ledger.delta_micro`, `withdrawals.amount_micro`, shop/task/referral reward columns, and backfills each legacy integer value by multiplying by 1,000,000. Version 2 adds settings, notifications, VIP, piggy banks, mining sessions, treasure boxes, gift codes, leaderboard events, events, withdrawal policies, and audit tables. Both migrations are transactional and idempotent.

The legacy `points` columns remain for compatibility. A trigger applies legacy integer point deltas to the micro balance without discarding an existing fractional remainder. New financial operations use the central credit/debit helper and append an immutable ledger record inside the same SQLite transaction.

Before production rollout, make a filesystem-level backup of `data.sqlite`, `data.sqlite-wal`, and `data.sqlite-shm`, restore the copy into an isolated directory, run the migration there, verify `PRAGMA integrity_check`, compare row counts and balances, and only then plan a reviewed rollout. This task did not migrate production data.
