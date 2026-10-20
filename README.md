# SUN REWARD — Telegram Mini App starter

A beginner-friendly starter for a Telegram Mini App with:
- Telegram WebApp user sign-in (server validates Telegram `initData`)
- task list and one-time task claims
- referral links (`startapp=ref_<telegram_id>`)
- points balance and ledger
- withdrawal requests (requests only; no automatic money/crypto payout)
- admin endpoints for approving tasks and reviewing withdrawals

## Important
This is a starter project, not a finished money-making business. Points have no cash value until you fund and operate a legitimate reward program. Never promise withdrawals you cannot fund. Do not ask users to pay a deposit, tax, or VIP fee to withdraw.

## Requirements
- Node.js 20+
- A Telegram bot created with @BotFather
- A host that can run a persistent Node.js server and SQLite, or adapt the database layer for a managed database.
- HTTPS public URL for Telegram Mini App.

## Run locally
1. Install Node.js on a computer/server (Android-only hosting is not the easiest path).
2. Copy `.env.example` to `.env` and set:
   - `BOT_TOKEN` to your bot token (keep secret; never commit it)
   - `ADMIN_KEY` to a long random secret
   - `APP_URL` to your HTTPS app URL
3. Run:
   ```sh
   npm install
   npm start
   ```
4. Open `http://localhost:3000` for a browser preview. Telegram login verification will only work with real Telegram WebApp `initData`.
5. Deploy to a Node.js host that supports persistent storage. SQLite needs a persistent disk. If your host has ephemeral storage, use a managed database and adapt `server.js`.

## Telegram setup
In @BotFather:
- `/setmenubutton` (or Bot Settings > Menu Button)
- select your bot
- set button text such as `Open App`
- set the HTTPS URL from your deployment

If BotFather asks for a Web App URL, it must be HTTPS.

## Admin
Use the `X-Admin-Key` header with your `ADMIN_KEY` for:
- `GET /api/admin/withdrawals`
- `POST /api/admin/withdrawals/:id` with JSON `{ "status": "approved" }` or `{ "status": "rejected" }`

This is a minimal admin API, not an admin dashboard. Review requests manually and keep records. Approval changes status only; it does not send money.

## Included demo tasks
The tasks are starter tasks. The server currently supports a daily check-in and referral bonus. Do not reward unverifiable actions like "join any channel" without adding server-side verification.

## Security checklist before public launch
- Use a unique, long `ADMIN_KEY`.
- Never put `BOT_TOKEN` or `ADMIN_KEY` in frontend files or GitHub.
- Add rate limiting, monitoring, backups, privacy policy, and abuse controls.
- Add proper task verification before awarding points.
- Define clear reward terms and only offer withdrawals you can actually fund.
