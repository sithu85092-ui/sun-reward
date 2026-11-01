"use strict";
const crypto = require("crypto");

function validId(value) { return typeof value === "string" && /^\d{1,20}$/.test(value); }

function verifyTelegramInitData(initData, botToken, nowMs = Date.now()) {
  if (!botToken) throw new Error("Server is missing BOT_TOKEN.");
  if (!initData || typeof initData !== "string") throw new Error("Open this app from Telegram.");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Telegram initData hash is invalid.");
  params.delete("hash");
  const authDate = Number(params.get("auth_date") || 0);
  const seconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > seconds + 60 || seconds - authDate > 3600) {
    throw new Error("Telegram session expired. Reopen the app.");
  }
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(calculated, "hex"); const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Telegram signature verification failed.");
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { throw new Error("Telegram user data is invalid."); }
  if (!user || !user.id || !validId(String(user.id))) throw new Error("Telegram user ID is missing.");
  return { user, startParam: params.get("start_param") || "" };
}

module.exports = { verifyTelegramInitData };
