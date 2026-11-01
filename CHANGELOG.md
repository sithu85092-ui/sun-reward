
## Verification fixes — 2026-11-01

- Corrected Telegram `auth_date` validation to use Unix seconds.
- Extracted authentication verification for deterministic timestamp/signature tests.
- Changed rejected-withdrawal refunds to use the exact stored micro-SUN amount and block repeated state transitions.
- Consolidated legacy reward paths onto the canonical micro-SUN ledger helper.
- Added withdrawal transition tests and a complete executed test report.
