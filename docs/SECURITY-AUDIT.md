# Security audit report

The existing Telegram authentication is preserved: protected user routes validate Telegram `initData`, check the HMAC signature, validate the Telegram user identity, and reject stale sessions. SQL uses prepared statements, rate limits remain enabled, random reward selection uses Node cryptographic randomness, and balance changes occur in transactions.

The new economy validates fixed-point amounts, applies server-side timestamps, prevents repeated gift-code redemption, caps mining duration, stores withdrawal estimates at request time, uses policy limits, and records ledger entries for new balance operations. No secret values are present in the source or ZIP.

The existing admin model remains a shared `ADMIN_KEY` passed in an HTTP header. It is timing-safe and server-enforced, but it is not named-admin RBAC/MFA. Before high-value financial operations, replace it with short-lived authenticated admin sessions, an allowlist or named roles, admin-specific rate limits, CSRF/origin controls, and mandatory audit actor IDs. Payment approval remains a status change and never claims that money was sent.

Production operators should use HTTPS, persistent Render storage, secret environment configuration, restricted admin access, database backups, and a single-writer SQLite deployment. Do not expose logs containing Telegram authentication data or payment details.
