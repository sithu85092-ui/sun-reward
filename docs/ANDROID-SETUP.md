# Android and Termux setup

On Android, install Termux from a trusted source, then run `pkg update && pkg install nodejs git unzip`. Extract the ZIP with `unzip SUN-REWARD-final.zip`, enter the project directory, run `npm install`, copy `.env.example` to `.env`, and edit it with `nano` or Acode. Keep `BOT_TOKEN` and `ADMIN_KEY` only in `.env`; never paste them into chat or commit them.

Run `npm run check` and `npm test` before starting with `npm start`. Test the health endpoint with `curl http://127.0.0.1:3000/health`. Telegram authentication is expected to fail in an ordinary browser; open the deployed HTTPS Mini App from Telegram for authenticated routes.

For Acode, open the extracted project directory and edit source files directly. Do not edit `node_modules`, `data.sqlite`, or `.env` for sharing. The ZIP intentionally excludes those private/generated artifacts.

For Render, upload the reviewed source through the approved repository workflow, configure persistent disk storage and environment variables in Render, run the health check, and perform a backup/restore drill before any production migration. This project was not deployed by this task. A production rollout requires explicit approval.
