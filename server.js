
"use strict";

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || "";

const REFERRAL_POINTS = Math.max(
  0,
  Number(process.env.POINTS_PER_REFERRAL || 50)
);
const DAILY_POINTS = Math.max(
  0,
  Number(process.env.DAILY_CHECKIN_POINTS || 5)
);
const MIN_WITHDRAWAL = Math.max(
  1,
  Number(process.env.MIN_WITHDRAWAL_POINTS || 1000)
);

const MAX_ENERGY = 100;
const ENERGY_REGEN_PER_MINUTE = 1;
const TAP_POWER_DEFAULT = 1;
const SEED_COST = 100;
const WATER_COST = 10;
const SPIN_TICKET_COST = 100;
const UPGRADE_COST = 250;
const MIN_PLANT_REFERRALS = 3;

const db = new Database(path.join(__dirname, "data.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  referred_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_claims (
  telegram_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY(telegram_id, task_id)
);

CREATE TABLE IF NOT EXISTS checkins (
  telegram_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY(telegram_id, day)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`);

// Safe schema migration: retain existing users and balances.
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("users", "username", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("users", "photo_url", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("users", "vip_until", "TEXT");
addColumnIfMissing("users", "channel_verified", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "energy", `INTEGER NOT NULL DEFAULT ${MAX_ENERGY}`);
addColumnIfMissing("users", "energy_updated_at", "TEXT");
addColumnIfMissing("users", "tap_power", `INTEGER NOT NULL DEFAULT ${TAP_POWER_DEFAULT}`);
addColumnIfMissing("users", "seeds", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "spin_tickets", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "plant_stage", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "plant_growth", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "plant_planted_at", "TEXT");

db.exec(`
CREATE TABLE IF NOT EXISTS referral_rewards (
  referred_id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  cost INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_user
  ON ledger(telegram_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_users_referrer
  ON users(referred_by);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
  ON withdrawals(status);
`);

const now = () => new Date().toISOString();

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function validId(value) {
  return typeof value === "string" && /^\d{1,20}$/.test(value);
}

function isVip(user) {
  return Boolean(
    user &&
    user.vip_until &&
    Number.isFinite(Date.parse(user.vip_until)) &&
    Date.parse(user.vip_until) > Date.now()
  );
}

// Telegram Mini App initData signature verification.
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) {
    throw new Error("Server is missing BOT_TOKEN.");
  }

  if (!initData || typeof initData !== "string") {
    throw new Error("Open this app from Telegram.");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error("Telegram initData hash is invalid.");
  }

  params.delete("hash");

  const authDate = Number(params.get("auth_date") || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(authDate) ||
    authDate <= 0 ||
    authDate > nowSeconds + 60 ||
    nowSeconds - authDate > 3600
  ) {
    throw new Error("Telegram session expired. Reopen the app.");
  }

  const entries = [...params.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculatedHash, "hex");
  const b = Buffer.from(hash, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Telegram signature verification failed.");
  }

  let user;

  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    throw new Error("Telegram user data is invalid.");
  }

  if (!user || !user.id || !validId(String(user.id))) {
    throw new Error("Telegram user ID is missing.");
  }

  return {
    user,
    startParam: params.get("start_param") || ""
  };
}

function auth(req, res, next) {
  try {
    req.telegram = verifyTelegramInitData(
      req.get("X-Telegram-Init-Data")
    );

    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

function isAdmin(req, res, next) {
  const provided = req.get("X-Admin-Key") || "";

  if (
    !ADMIN_KEY ||
    Buffer.byteLength(provided) !== Buffer.byteLength(ADMIN_KEY) ||
    !crypto.timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(ADMIN_KEY)
    )
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

function addLedger(telegramId, delta, description) {
  db.prepare(`
    INSERT INTO ledger(telegram_id, delta, description, created_at)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, delta, description, now());
}

function getOrCreateUser(telegramUser, startParam = "") {
  const id = String(telegramUser.id);
  const firstName = String(telegramUser.first_name || "Friend").slice(0, 100);
  const username = String(telegramUser.username || "").slice(0, 100);
  const photoUrl = String(telegramUser.photo_url || "").slice(0, 1000);

  const existing = db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .get(id);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET first_name = ?, username = ?, photo_url = ?
      WHERE telegram_id = ?
    `).run(firstName, username, photoUrl, id);

    return db.prepare(
      "SELECT * FROM users WHERE telegram_id = ?"
    ).get(id);
  }

  let referrer = null;
  const match = /^ref_(\d{1,20})$/.exec(startParam);

  if (match && match[1] !== id) {
    const referrerExists = db.prepare(
      "SELECT telegram_id FROM users WHERE telegram_id = ?"
    ).get(match[1]);

    if (referrerExists) {
      referrer = match[1];
    }
  }

  db.prepare(`
    INSERT INTO users(
      telegram_id, first_name, username, photo_url,
      referred_by, created_at, energy_updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    firstName,
    username,
    photoUrl,
    referrer,
    now(),
    now()
  );

  return db.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  ).get(id);
}

// Telegram Bot API. The bot should be an administrator of the channel
// to reliably check membership.
async function telegramBotApi(method, payload = {}) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not configured.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || "Telegram API request failed.");
  }

  return data.result;
}

async function checkChannelMembership(telegramId) {
  if (!REQUIRED_CHANNEL) {
    return {
      configured: false,
      member: false,
      error: "REQUIRED_CHANNEL is not configured."
    };
  }

  try {
    const result = await telegramBotApi("getChatMember", {
      chat_id: REQUIRED_CHANNEL,
      user_id: Number(telegramId)
    });

    const member = ["creator", "administrator", "member"].includes(
      result.status
    ) || (
      result.status === "restricted" &&
      result.is_member === true
    );

    return { configured: true, member };
  } catch {
    // Fail closed. Do not unlock features when verification fails.
    return {
      configured: true,
      member: false,
      error: "Channel membership could not be verified."
    };
  }
}

// Award a referral bonus only once, after the invited user has joined
// the configured channel and Telegram confirms membership.
function rewardEligibleReferral(referredId) {
  const referred = db.prepare(`
    SELECT telegram_id, referred_by, channel_verified
    FROM users
    WHERE telegram_id = ?
  `).get(referredId);

  if (
    !referred ||
    !referred.referred_by ||
    referred.channel_verified !== 1
  ) {
    return false;
  }

  const tx = db.transaction(() => {
    const referrerExists = db.prepare(
      "SELECT telegram_id FROM users WHERE telegram_id = ?"
    ).get(referred.referred_by);

    if (!referrerExists) return false;

    const inserted = db.prepare(`
      INSERT OR IGNORE INTO referral_rewards(
        referred_id, referrer_id, points, created_at
      )
      VALUES (?, ?, ?, ?)
    `).run(
      referred.telegram_id,
      referred.referred_by,
      REFERRAL_POINTS,
      now()
    );

    if (!inserted.changes) return false;

    if (REFERRAL_POINTS > 0) {
      db.prepare(`
        UPDATE users
        SET points = points + ?
        WHERE telegram_id = ?
      `).run(REFERRAL_POINTS, referred.referred_by);

      addLedger(
        referred.referred_by,
        REFERRAL_POINTS,
        "Eligible referral bonus"
      );
    }

    return true;
  });

  return tx();
}

async function syncChannelMembership(userId) {
  const status = await checkChannelMembership(userId);

  // Without a configured channel, no channel-gated feature is unlocked.
  if (!status.configured) {
    return status;
  }

  db.prepare(`
    UPDATE users SET channel_verified = ? WHERE telegram_id = ?
  `).run(status.member ? 1 : 0, userId);

  if (status.member) {
    rewardEligibleReferral(userId);
  }

  return status;
}

function getReferralCount(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM users u
    INNER JOIN referral_rewards r
      ON r.referred_id = u.telegram_id
    WHERE u.referred_by = ?
  `).get(userId).count;
}

function isPlantUnlocked(user) {
  return Boolean(
    user &&
    user.channel_verified === 1 &&
    getReferralCount(user.telegram_id) >= MIN_PLANT_REFERRALS
  );
}

function updateEnergy(user) {
  const current = Math.max(
    0,
    Math.min(MAX_ENERGY, Number(user.energy) || 0)
  );

  const previousTime = Date.parse(user.energy_updated_at || "");
  const elapsedMinutes = Number.isFinite(previousTime)
    ? Math.max(0, (Date.now() - previousTime) / 60000)
    : 0;

  const recovered = Math.floor(
    elapsedMinutes * ENERGY_REGEN_PER_MINUTE
  );

  const energy = Math.min(MAX_ENERGY, current + recovered);

  // Do not discard fractional regeneration time while energy is below max.
  let updatedAt = user.energy_updated_at || now();

  if (energy >= MAX_ENERGY) {
    updatedAt = now();
  } else if (recovered > 0) {
    updatedAt = new Date(
      previousTime + recovered * 60000
    ).toISOString();
  }

  db.prepare(`
    UPDATE users SET energy = ?, energy_updated_at = ?
    WHERE telegram_id = ?
  `).run(energy, updatedAt, user.telegram_id);

  return db.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  ).get(user.telegram_id);
}

function requirePlantAccess(req, res) {
  const user = db.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  ).get(String(req.telegram.user.id));

  if (!user || !isPlantUnlocked(user)) {
    res.status(403).json({
      error: "Plant requires 3 eligible referrals and verified channel membership."
    });
    return null;
  }

  return user;
}

const taskList = [
  {
    id: "daily",
    title: "Daily check-in",
    description: "Claim your daily points once per UTC day.",
    points: DAILY_POINTS
  }
];

// -------------------- Account --------------------

app.get("/api/me", auth, async (req, res) => {
  try {
    let user = getOrCreateUser(
      req.telegram.user,
      req.telegram.startParam
    );

    const channel = await syncChannelMembership(user.telegram_id);

    user = updateEnergy(
      db.prepare("SELECT * FROM users WHERE telegram_id = ?")
        .get(user.telegram_id)
    );

    const claims = db.prepare(`
      SELECT task_id FROM task_claims WHERE telegram_id = ?
    `).all(user.telegram_id);

    const claimed = new Set(claims.map((row) => row.task_id));

    const ledger = db.prepare(`
      SELECT delta, description, created_at
      FROM ledger
      WHERE telegram_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).all(user.telegram_id);

    const referralLink = BOT_USERNAME
      ? `https://t.me/${BOT_USERNAME}?startapp=ref_${user.telegram_id}`
      : "";

    const vip = isVip(user);
    const referralCount = getReferralCount(user.telegram_id);

    res.json({
      user: {
        id: user.telegram_id,
        first_name: user.first_name,
        username: user.username,
        photo_url: user.photo_url,
        points: user.points,
        created_at: user.created_at,
        vip,
        vipExpiry: user.vip_until,
        energy: user.energy,
        energyMax: MAX_ENERGY,
        tapPower: user.tap_power,
        seeds: user.seeds,
        spinTickets: user.spin_tickets,
        plant: {
          unlocked: isPlantUnlocked(user),
          stage: user.plant_stage,
          growth: user.plant_growth
        },
        referral_count: referralCount
      },
      tasks: taskList.map((task) => ({
        ...task,
        completed: claimed.has(task.id)
      })),
      ledger,
      referralLink,
      referralCount,
      channel: {
        configured: channel.configured,
        member: channel.member
      },
      plantUnlocked: isPlantUnlocked(user),
      config: {
        referralPoints: REFERRAL_POINTS,
        minWithdrawalPoints: MIN_WITHDRAWAL,
        minPlantReferrals: MIN_PLANT_REFERRALS,
        requiredChannel: REQUIRED_CHANNEL
      }
    });
  } catch (error) {
    console.error("GET /api/me failed:", error.message);
    res.status(500).json({ error: "Could not load account." });
  }
});

// -------------------- Daily check-in --------------------

app.post("/api/checkin", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  const tx = db.transaction(() => {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO checkins(telegram_id, day)
      VALUES (?, ?)
    `).run(user.telegram_id, utcDay());

    if (!inserted.changes) return false;

    db.prepare(`
      UPDATE users SET points = points + ?
      WHERE telegram_id = ?
    `).run(DAILY_POINTS, user.telegram_id);

    addLedger(user.telegram_id, DAILY_POINTS, "Daily check-in");
    return true;
  });

  if (!tx()) {
    return res.status(409).json({
      error: "Daily check-in already claimed today."
    });
  }

  res.json({
    ok: true,
    points: DAILY_POINTS,
    message: `Daily check-in: +${DAILY_POINTS} SUN`
  });
});

// -------------------- Tasks --------------------

app.post("/api/tasks/:id/claim", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  const task = taskList.find((item) => item.id === req.params.id);

  if (!task) {
    return res.status(404).json({ error: "Task not found." });
  }

  if (task.id === "daily") {
    return res.status(400).json({
      error: "Use daily check-in for this task."
    });
  }

  res.status(400).json({
    error: "No claimable task configured."
  });
});

// -------------------- Tap to Earn --------------------

app.post("/api/tap", auth, (req, res) => {
  let user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  user = updateEnergy(user);

  if (user.energy < 1) {
    return res.status(429).json({
      error: "No energy left. Wait for energy to regenerate."
    });
  }

  const earned = Math.max(1, Math.min(100, Number(user.tap_power) || 1));

  const tx = db.transaction(() => {
    const fresh = db.prepare(`
      SELECT points, energy FROM users WHERE telegram_id = ?
    `).get(user.telegram_id);

    if (!fresh || fresh.energy < 1) {
      throw new Error("No energy left.");
    }

    db.prepare(`
      UPDATE users
      SET energy = energy - 1, points = points + ?
      WHERE telegram_id = ?
    `).run(earned, user.telegram_id);

    addLedger(user.telegram_id, earned, "Tap to Earn");
  });

  try {
    tx();
    res.json({
      ok: true,
      earned,
      message: `+${earned} SUN`
    });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

// -------------------- Plant --------------------

app.post("/api/plant/verify", auth, async (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  const channel = await syncChannelMembership(user.telegram_id);

  const fresh = db.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  ).get(user.telegram_id);

  const unlocked = isPlantUnlocked(fresh);

  res.json({
    ok: true,
    plantUnlocked: unlocked,
    plant: {
      unlocked,
      stage: fresh.plant_stage,
      growth: fresh.plant_growth
    },
    message: unlocked
      ? "Garden unlocked."
      : `Plant requires ${MIN_PLANT_REFERRALS} eligible referrals and channel membership.`,
    channel
  });
});

app.post("/api/plant/buy-seed", auth, (req, res) => {
  const user = requirePlantAccess(req, res);
  if (!user) return;

  const tx = db.transaction(() => {
    const fresh = db.prepare(
      "SELECT points FROM users WHERE telegram_id = ?"
    ).get(user.telegram_id);

    if (fresh.points < SEED_COST) {
      throw new Error(`You need ${SEED_COST} SUN to buy a seed.`);
    }

    db.prepare(`
      UPDATE users SET points = points - ?, seeds = seeds + 1
      WHERE telegram_id = ?
    `).run(SEED_COST, user.telegram_id);

    addLedger(user.telegram_id, -SEED_COST, "Bought plant seed");

    db.prepare(`
      INSERT INTO shop_purchases(telegram_id, item_id, cost, created_at)
      VALUES (?, 'seed', ?, ?)
    `).run(user.telegram_id, SEED_COST, now());
  });

  try {
    tx();
    res.json({ ok: true, message: "Seed purchased." });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/plant/plant", auth, (req, res) => {
  const user = requirePlantAccess(req, res);
  if (!user) return;

  if (user.plant_stage > 0) {
    return res.status(409).json({
      error: "You already have a plant growing."
    });
  }

  if (user.seeds < 1) {
    return res.status(400).json({
      error: "Buy a seed before planting."
    });
  }

  db.prepare(`
    UPDATE users
    SET seeds = seeds - 1, plant_stage = 1,
        plant_growth = 0, plant_planted_at = ?
    WHERE telegram_id = ?
  `).run(now(), user.telegram_id);

  res.json({ ok: true, message: "Seed planted." });
});

app.post("/api/plant/water", auth, (req, res) => {
  const user = requirePlantAccess(req, res);
  if (!user) return;

  if (user.plant_stage < 1) {
    return res.status(400).json({
      error: "Plant a seed first."
    });
  }

  if (user.plant_growth >= 100) {
    return res.status(400).json({
      error: "Your plant is ready to harvest."
    });
  }

  const tx = db.transaction(() => {
    const fresh = db.prepare(`
      SELECT points, plant_growth
      FROM users WHERE telegram_id = ?
    `).get(user.telegram_id);

    if (fresh.points < WATER_COST) {
      throw new Error(`You need ${WATER_COST} SUN to water your plant.`);
    }

    const growth = Math.min(100, fresh.plant_growth + 25);

    db.prepare(`
      UPDATE users
      SET points = points - ?, plant_growth = ?
      WHERE telegram_id = ?
    `).run(WATER_COST, growth, user.telegram_id);

    addLedger(user.telegram_id, -WATER_COST, "Watered plant");
  });

  try {
    tx();
    res.json({ ok: true, message: "Plant watered. Growth increased." });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/plant/harvest", auth, (req, res) => {
  const user = requirePlantAccess(req, res);
  if (!user) return;

  if (user.plant_stage < 1 || user.plant_growth < 100) {
    return res.status(400).json({
      error: "Your plant is not ready to harvest."
    });
  }

  const reward = 150;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET points = points + ?, plant_stage = 0,
          plant_growth = 0, plant_planted_at = NULL
      WHERE telegram_id = ?
    `).run(reward, user.telegram_id);

    addLedger(user.telegram_id, reward, "Plant harvest");
  });

  tx();

  res.json({
    ok: true,
    reward,
    message: `Harvest complete: +${reward} SUN`
  });
});

// -------------------- Shop --------------------

const shopItems = [
  { id: "seed", title: "Plant Seed", cost: SEED_COST },
  { id: "spin_ticket", title: "Spin Ticket", cost: SPIN_TICKET_COST },
  { id: "tap_upgrade", title: "Tap Power Upgrade", cost: UPGRADE_COST }
];

app.get("/api/shop", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  res.json({
    items: shopItems,
    inventory: {
      seeds: user.seeds,
      spinTickets: user.spin_tickets,
      tapPower: user.tap_power
    }
  });
});

app.post("/api/shop/buy", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  const item = shopItems.find(
    (candidate) => candidate.id === req.body?.itemId
  );

  if (!item) {
    return res.status(400).json({ error: "Unknown shop item." });
  }

  const tx = db.transaction(() => {
    const fresh = db.prepare(`
      SELECT points, seeds, spin_tickets, tap_power
      FROM users WHERE telegram_id = ?
    `).get(user.telegram_id);

    if (fresh.points < item.cost) {
      throw new Error("Not enough SUN points.");
    }

    db.prepare(`
      UPDATE users SET points = points - ?
      WHERE telegram_id = ?
    `).run(item.cost, user.telegram_id);

    if (item.id === "seed") {
      db.prepare(`
        UPDATE users SET seeds = seeds + 1 WHERE telegram_id = ?
      `).run(user.telegram_id);
    } else if (item.id === "spin_ticket") {
      db.prepare(`
        UPDATE users SET spin_tickets = spin_tickets + 1
        WHERE telegram_id = ?
      `).run(user.telegram_id);
    } else if (item.id === "tap_upgrade") {
      db.prepare(`
        UPDATE users SET tap_power = tap_power + 1
        WHERE telegram_id = ?
      `).run(user.telegram_id);
    }

    addLedger(user.telegram_id, -item.cost, `Shop purchase: ${item.title}`);

    db.prepare(`
      INSERT INTO shop_purchases(telegram_id, item_id, cost, created_at)
      VALUES (?, ?, ?, ?)
    `).run(user.telegram_id, item.id, item.cost, now());
  });

  try {
    tx();
    res.json({ ok: true, message: `${item.title} purchased.` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// -------------------- Spin --------------------
// Points only. No real-money or cryptocurrency prize is paid by this API.

app.post("/api/spin", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  const rewards = [
    { points: 0, weight: 20 },
    { points: 5, weight: 35 },
    { points: 10, weight: 25 },
    { points: 25, weight: 15 },
    { points: 50, weight: 5 }
  ];

  const totalWeight = rewards.reduce(
    (sum, reward) => sum + reward.weight,
    0
  );

  const tx = db.transaction(() => {
    const fresh = db.prepare(`
      SELECT spin_tickets FROM users WHERE telegram_id = ?
    `).get(user.telegram_id);

    if (!fresh || fresh.spin_tickets < 1) {
      throw new Error("You need a spin ticket.");
    }

    db.prepare(`
      UPDATE users SET spin_tickets = spin_tickets - 1
      WHERE telegram_id = ?
    `).run(user.telegram_id);

    // Use cryptographically secure randomness for reward selection.
    let roll = crypto.randomInt(totalWeight);
    let reward = rewards[0];

    for (const candidate of rewards) {
      if (roll < candidate.weight) {
        reward = candidate;
        break;
      }
      roll -= candidate.weight;
    }

    if (reward.points > 0) {
      db.prepare(`
        UPDATE users SET points = points + ?
        WHERE telegram_id = ?
      `).run(reward.points, user.telegram_id);

      addLedger(user.telegram_id, reward.points, "Spin reward");
    }

    return reward.points;
  });

  try {
    const points = tx();

    res.json({
      ok: true,
      points,
      message: points > 0
        ? `You won ${points} SUN points.`
        : "No points this time. Try again with another ticket."
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// -------------------- VIP --------------------
// VIP is granted only through a trusted admin action.
// No public endpoint can grant VIP to the caller.

app.get("/api/vip", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  res.json({
    vip: isVip(user),
    vipExpiry: user.vip_until || null,
    message: isVip(user)
      ? "Active VIP membership."
      : "No active VIP membership."
  });
});

// -------------------- Withdrawals --------------------

app.post("/api/withdrawals", auth, (req, res) => {
  const user = getOrCreateUser(
    req.telegram.user,
    req.telegram.startParam
  );

  // Server-side VIP verification cannot be bypassed by the frontend.
  if (!isVip(user)) {
    return res.status(403).json({
      error: "An active VIP membership is required to request withdrawal."
    });
  }

  const points = Number(req.body?.points);
  const method = String(req.body?.method || "manual_review");

  const allowedMethods = [
    "manual_review",
    "TON",
    "USDT",
    "KBZPay",
    "WavePay"
  ];

  if (
    !Number.isSafeInteger(points) ||
    points < MIN_WITHDRAWAL
  ) {
    return res.status(400).json({
      error: `Minimum request is ${MIN_WITHDRAWAL} points.`
    });
  }

  if (!allowedMethods.includes(method)) {
    return res.status(400).json({
      error: "Unsupported method."
    });
  }

  const tx = db.transaction(() => {
    const fresh = db.prepare(`
      SELECT points, vip_until FROM users WHERE telegram_id = ?
    `).get(user.telegram_id);

    if (!isVip(fresh)) {
      throw new Error("An active VIP membership is required.");
    }

    if (fresh.points < points) {
      throw new Error("Not enough points.");
    }

    db.prepare(`
      UPDATE users SET points = points - ?
      WHERE telegram_id = ?
    `).run(points, user.telegram_id);

    const result = db.prepare(`
      INSERT INTO withdrawals(
        telegram_id, points, method, status, created_at
      )
      VALUES (?, ?, ?, 'pending', ?)
    `).run(user.telegram_id, points, method, now());

    addLedger(
      user.telegram_id,
      -points,
      `Withdrawal request #${result.lastInsertRowid}`
    );

    return result.lastInsertRowid;
  });

  try {
    const id = tx();

    res.json({
      ok: true,
      id,
      message: "Request submitted for manual review. Payout is not guaranteed."
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// -------------------- Admin APIs --------------------

app.get("/api/admin/withdrawals", isAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, telegram_id, points, method, status, created_at
    FROM withdrawals
    ORDER BY id DESC
    LIMIT 100
  `).all();

  res.json(rows);
});

app.post("/api/admin/withdrawals/:id", isAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "");

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid request ID." });
  }

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({
      error: "Status must be approved or rejected."
    });
  }

  const tx = db.transaction(() => {
    const withdrawal = db.prepare(
      "SELECT * FROM withdrawals WHERE id = ?"
    ).get(id);

    if (!withdrawal) {
      throw new Error("Request not found.");
    }

    if (withdrawal.status !== "pending") {
      throw new Error("Request already reviewed.");
    }

    db.prepare(`
      UPDATE withdrawals SET status = ? WHERE id = ?
    `).run(status, id);

    if (status === "rejected") {
      db.prepare(`
        UPDATE users SET points = points + ?
        WHERE telegram_id = ?
      `).run(withdrawal.points, withdrawal.telegram_id);

      addLedger(
        withdrawal.telegram_id,
        withdrawal.points,
        `Refund for rejected request #${id}`
      );
    }
  });

  try {
    tx();

    res.json({
      ok: true,
      status,
      note: "Status updated only. No money or cryptocurrency was transferred."
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Grant or extend VIP using a trusted admin action.
// Request body: { "days": 30 }
// Header: X-Admin-Key: <your ADMIN_KEY>
app.post("/api/admin/users/:id/vip", isAdmin, (req, res) => {
  const id = String(req.params.id);
  const days = Number(req.body?.days);

  if (!validId(id)) {
    return res.status(400).json({ error: "Invalid Telegram user ID." });
  }

  if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({
      error: "days must be an integer between 1 and 365."
    });
  }

  const user = db.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  ).get(id);

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  const baseTime = isVip(user) ? Date.parse(user.vip_until) : Date.now();
  const vipUntil = new Date(
    baseTime + days * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(`
    UPDATE users SET vip_until = ? WHERE telegram_id = ?
  `).run(vipUntil, id);

  res.json({
    ok: true,
    telegram_id: id,
    vip_until: vipUntil,
    note: "VIP granted by admin. No payment was processed."
  });
});

// -------------------- Health and frontend --------------------

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "SUN REWARD" });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`SUN REWARD listening on port ${PORT}`);
});
