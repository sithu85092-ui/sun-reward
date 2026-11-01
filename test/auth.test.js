"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyTelegramInitData } = require("../auth");

const token = "123456:TEST_BOT_TOKEN";
const nowMs = Date.parse("2026-11-01T10:00:00.000Z");
function signed(authDate, extra = {}) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id: 12345, first_name: "Test" }), ...extra });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

const current = Math.floor(nowMs / 1000);
assert.equal(verifyTelegramInitData(signed(current), token, nowMs).user.id, 12345);
assert.throws(() => verifyTelegramInitData(signed(current - 3601), token, nowMs), /expired/);
assert.throws(() => verifyTelegramInitData(signed(current + 61), token, nowMs), /expired/);
assert.throws(() => verifyTelegramInitData(signed(current).replace(/.$/, "0"), token, nowMs), /signature/);
const missing = new URLSearchParams({ user: JSON.stringify({ id: 12345 }) }).toString();
assert.throws(() => verifyTelegramInitData(missing, token, nowMs), /hash is invalid/);
const noDate = signed(current); const noDateParams = new URLSearchParams(noDate); noDateParams.delete("auth_date");
assert.throws(() => verifyTelegramInitData(noDateParams.toString(), token, nowMs), /expired/);
console.log("authentication tests: ok");
