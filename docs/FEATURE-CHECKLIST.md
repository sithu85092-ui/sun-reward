# Feature checklist

| Area | Status | Evidence or limitation |
|---|---|---|
| Telegram auth, profile, referrals | Preserved | Existing HMAC, channel, referral, profile, and ledger routes remain in `server.js`. |
| Exact fractional SUN | Implemented | `migrations.js`, micro-SUN columns, central balance helper, 0.001 SUN tap. |
| Mining | Implemented internally | Server-timed 0.0001 SUN/sec, two-hour cap, claim endpoint. |
| VIP 1–10 | Implemented internally | Configurable seed rows, purchase endpoint, duration/frame/reward fields. |
| Withdrawals | Implemented internally | Non-VIP/VIP policy, limits, KBZPay/WavePay estimates, manual approval/refund path. |
| Inbox and events | Implemented internally | Notification read state and active event/ticker APIs. |
| Piggy Bank | Implemented internally | Transactional deposit and withdrawal. |
| Treasure boxes | Implemented internally | Ten levels, secure random reward range, opening history. |
| Gift codes | Implemented internally | Admin creation and idempotent user redemption. |
| Leaderboards | Implemented internally | Daily, monthly, yearly top 100 reward-event queries. |
| Tasks/socials/shop/garden/spin/wallet | Preserved | Existing features retained; legacy integer admin reward fields remain compatible. |
| Admin dashboard | Partial | Existing admin console plus new admin APIs; shared-key model remains and full RBAC/MFA is not included. |
| External payouts | Not implemented | No paid API or payment transfer was authorized; approval never sends funds. |
| Social verification/airdrop campaigns | Partial/not implemented | Safe internal task/notification primitives exist; external verification and full campaign rules need a defined provider/business policy. |
