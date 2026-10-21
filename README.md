# SUN REWARD — Telegram Mini App

A Telegram Web App with SUN points, tap-to-earn, daily check-in, referral tracking, task management, social links, shop inventory, upgrade cards, garden/seed planting, TON Connect UI, VIP-gated withdrawal requests, and an admin console.

## Features

- Telegram `initData` HMAC validation on every user API route.
- SQLite database with additive migrations. Existing `data.sqlite` is retained; do not delete it.
- Tap-to-earn with regenerating energy and daily check-in.
- Referral tracking and channel membership checks.
- Garden: buy seeds, plant, water, harvest; existing 3 eligible referrals + channel membership requirement is preserved.
- Shop: Plant Seed, Spin Ticket, Energy Refill, Tap Power +1, Tap Power +5.
- Tasks: admin create/edit/enable/disable; user claims; admin approval/rejection. Rejected tasks can be resubmitted.
- Social links: admin add/edit/enable/disable/delete.
- TON Connect wallet UI with server-side address association to the Telegram account.
- VIP-gated withdrawal request queue with manual admin review. Approving a request does not send money.
- Rate limiting, Helmet, HTTPS URL validation, timing-safe admin key comparison, SQLite transactions for balance changes.

## Requirements

- Node.js 20+
- A Telegram bot token and bot username
- A public HTTPS deployment URL for Telegram Mini App and TON Connect manifest

## Setup

1. Back up the current database before replacing project files: copy `data.sqlite` somewhere safe.
2. Install dependencies: `npm install`.
3. Copy `.env.example` to `.env` and fill in `BOT_TOKEN`, `BOT_USERNAME`, a long random `ADMIN_KEY`, and `REQUIRED_CHANNEL`.
4. Deploy behind HTTPS. Set `TON_CONNECT_MANIFEST_URL` to the public HTTPS URL of `tonconnect-manifest.json`.
5. Edit `tonconnect-manifest.json`: replace `https://your-domain.example` with your actual public domain and set a real publicly reachable app icon URL. The manifest must be reachable without login.
6. Run `npm start`.
7. Configure your Telegram bot's Main Mini App URL to the deployed HTTPS URL. The bot must be able to check membership in `REQUIRED_CHANNEL` (typically the bot needs appropriate channel permissions).
8. Open the Mini App from Telegram. API authentication intentionally rejects ordinary browser sessions without valid Telegram `initData`.
9. Enter the admin key in Admin Console to create tasks and social links. Keep the key only in `.env`; never place it in frontend code or public repositories.

## Wallet notes

TON Connect requires a public manifest URL and an HTTPS app domain. The app stores the address reported by TON Connect against the authenticated Telegram user. This address association is not a payment transaction, does not transfer funds, and is not by itself a server-verified TON Connect proof for high-value payouts. Add proof verification and payout reconciliation before using the address for financial authorization.

## Database safety

- Keep the existing `data.sqlite` file when deploying an update.
- Schema changes use `ALTER TABLE ... ADD COLUMN` only when a column is missing.
- Back up the database before production changes.

## Important payout note

Withdrawal requests are records for manual review. Marking a request approved in the admin panel only changes its status; it does not transfer TON, USDT, KBZPay, or WavePay funds.


## Secure shop purchase & inventory APIs

Shop cards are now stored in SQLite (`shop_items`) and can be managed from the Admin console. Purchases are processed on the server in a SQLite transaction: the server looks up the active price, conditionally deducts SUN, applies an allowlisted effect, records the ledger entry and purchase record, and updates inventory. A client-supplied `requestId` is stored with a unique per-user index to prevent the same request from deducting SUN twice on retry.

- `GET /api/shop` — active cards and the signed-in user's inventory summary.
- `GET /api/inventory` — signed-in user's item inventory; cannot query another user.
- `POST /api/shop/buy` — body: `{ "itemId": "seed", "requestId": "unique-request-id" }`.
- `GET /api/admin/shop-items` — list cards (admin key required).
- `POST /api/admin/shop-items` — create a card (admin key required).
- `PATCH /api/admin/shop-items/:id` — edit price/title/description/category/effect/quantity/visibility.
- `DELETE /api/admin/shop-items/:id` — disables a card rather than deleting purchase history or inventory.
- `GET /api/admin/shop-purchases` — recent purchase audit history.
- `GET /api/admin/inventory/:telegramId` — inspect a user's inventory (admin key required).

Allowed effects are `seed`, `spin_ticket`, `energy_refill`, `tap_power`, and `inventory`. `inventory` grants a collectible inventory entry; it does not execute arbitrary code or arbitrary database updates. Admin must use a unique card ID. Do not expose `ADMIN_KEY` in public code or screenshots.

### Existing database compatibility

New tables and the nullable `shop_purchases.request_id` column are created/migrated automatically without deleting the existing `data.sqlite`. Back up `data.sqlite` before deployment. Existing default card IDs and current prices are inserted only when missing, so admin changes are not overwritten on restart. The original `users.seeds` and `users.spin_tickets` counters remain supported while new purchases also create inventory records.

### Verification status

`node --check server.js` and `node --check app.js` pass. Full integration tests were not run in this environment because the `better-sqlite3` package is not installed here; run `npm install` and test purchases on a backed-up development database before production use.
