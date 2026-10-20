# SUN REWARD — Social Tasks/Admin patch

This patch is designed around the current public `main` branch of:
https://github.com/sithu85092-ui/sun-reward

It does NOT modify GitHub or deploy anything automatically. Commit the changes yourself, then let Render redeploy.

## Included
- `server-social-tasks-patch.js`: database schema + API code for dynamic social tasks, editable TikTok/Telegram links, user proof submission, admin approval/rejection.
- `admin.html`, `admin.css`, `admin.js`: small mobile-friendly admin panel.
- `app-js-renderTasks-replacement.js`: replacement `renderTasks()` function for the existing app.js.
- `README.md`: this guide.

## Very important before editing
1. Keep `data.sqlite`; do not delete it.
2. In Render, make sure SQLite is on a persistent disk. Otherwise data may be lost on restart/redeploy.
3. Never put `ADMIN_KEY` or `BOT_TOKEN` in frontend files or GitHub.
4. Take a copy of your current files before changing them.
5. This patch gives social-task points only after manual approval. It does not perform real money/crypto payouts or verify TikTok follows automatically.

## A. server.js integration
Current `server.js` on main is short and has a `taskList` constant and existing `/api/me` and `/api/tasks/:id/claim` routes.

1. Open `server.js`.
2. Keep the existing `const now = () => new Date().toISOString();`.
3. In `server-social-tasks-patch.js`, copy the first section starting at `const socialTaskSchema =` through the two `INSERT OR IGNORE` seed settings lines. Paste it immediately AFTER the existing `const now = ...` line. Do not paste the opening comment again.
4. Copy helper `validHttpUrl` and `publicTaskRows` too; paste after the seed settings.
5. Find `const taskList = [{id:"daily"...` and remove that constant. Do not remove `DAILY_POINTS`.
6. In `/api/me`, replace the current `tasks:taskList.map(...)` field with:
   Before `res.json(...)`, add `const checkedInToday = Boolean(db.prepare("SELECT 1 FROM checkins WHERE telegram_id=? AND day=?").get(u.telegram_id, day()));` then use `tasks:[{id:"daily",title:"Daily check-in",description:"Claim your daily points once per day.",points:DAILY_POINTS,completed:checkedInToday,kind:"daily"}, ...publicTaskRows(u.telegram_id)]`
   The existing `claimed` query may remain, but `task_claims` is no longer used for social tasks.
7. Remove the old route `app.post("/api/tasks/:id/claim", ... )` entirely; it returns “No claimable task configured.” Keep `/api/checkin`.
8. Copy the entire `ROUTES` section in `server-social-tasks-patch.js` (from `// Public social links.` to just before the end) into `server.js` after the existing admin routes and before `app.get("*",...)`.
9. Make sure you do not duplicate `validHttpUrl`, `publicTaskRows`, or schema if you pasted those separately.
10. Save and commit `server.js`.

## B. app.js integration
Open `app.js`, find `function renderTasks(tasks) {` (about line 1750 in current main). Replace that entire function up to just before `function renderLedger(rows)` with the content of `app-js-renderTasks-replacement.js`.

## C. Add admin files
Create these three files at the repository root:
- `admin.html`
- `admin.css`
- `admin.js`

Copy the matching included files exactly. Commit them.

## D. Open admin panel
After Render finishes deploying, open:
`https://sun-reward.onrender.com/admin.html`

Paste your existing `ADMIN_KEY` into the panel input. The key is stored only in `sessionStorage` for the current browser tab/session. Do not send it to me or place it in frontend source code.

## E. How to use
1. Admin → Social Tasks: create/edit tasks and rewards, enable/disable tasks.
2. Admin → Links: edit TikTok and Telegram URLs.
3. Admin → Submissions: choose Pending and Approve/Reject.
4. User visits task link, follows/joins, then submits a short proof note. Admin checks manually before approving.
5. On approval, server credits points and records a ledger entry in one transaction. A submission cannot be approved twice.

## Current limits
- TikTok/Telegram membership is not verified automatically. Admin must check the proof.
- Deleting a task is implemented as disable/archive to preserve submission history.
- `ADMIN_KEY` must be set in Render environment variables.
- This is a minimal admin panel, not full account/withdrawal/VIP management.
