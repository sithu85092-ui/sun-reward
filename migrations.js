"use strict";

const MIGRATION_VERSION = 2;
const MICRO_PER_SUN = 1000000;

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (!columnExists(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
  const now = () => new Date().toISOString();

  if (!applied.has(1)) {
    db.transaction(() => {
      addColumn(db, "users", "sun_micro", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "ledger", "delta_micro", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "withdrawals", "amount_micro", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "withdrawals", "payout_details", "TEXT NOT NULL DEFAULT ''");
      addColumn(db, "withdrawals", "usd_estimate", "REAL NOT NULL DEFAULT 0");
      addColumn(db, "withdrawals", "mmk_estimate", "REAL NOT NULL DEFAULT 0");
      addColumn(db, "shop_items", "cost_micro", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "shop_purchases", "cost_micro", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "managed_tasks", "reward_micro", "INTEGER NOT NULL DEFAULT 0");
      addColumn(db, "referral_rewards", "reward_micro", "INTEGER NOT NULL DEFAULT 0");
      db.exec("UPDATE users SET sun_micro=COALESCE(points,0)*1000000 WHERE sun_micro=0 AND COALESCE(points,0)<>0");
      db.exec("UPDATE ledger SET delta_micro=COALESCE(delta,0)*1000000 WHERE delta_micro=0 AND COALESCE(delta,0)<>0");
      db.exec("UPDATE withdrawals SET amount_micro=COALESCE(points,0)*1000000 WHERE amount_micro=0 AND COALESCE(points,0)<>0");
      db.exec("UPDATE shop_items SET cost_micro=COALESCE(cost,0)*1000000 WHERE cost_micro=0 AND COALESCE(cost,0)<>0");
      db.exec("UPDATE shop_purchases SET cost_micro=COALESCE(cost,0)*1000000 WHERE cost_micro=0 AND COALESCE(cost,0)<>0");
      db.exec("UPDATE managed_tasks SET reward_micro=COALESCE(points,0)*1000000 WHERE reward_micro=0 AND COALESCE(points,0)<>0");
      db.exec("UPDATE referral_rewards SET reward_micro=COALESCE(points,0)*1000000 WHERE reward_micro=0 AND COALESCE(points,0)<>0");
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(1, now());
    })();
  }

  if (!applied.has(2)) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info', read_at TEXT, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(telegram_id, read_at, id DESC);
        CREATE TABLE IF NOT EXISTS vip_levels (level INTEGER PRIMARY KEY, name TEXT NOT NULL, price_micro INTEGER NOT NULL, reward_micro INTEGER NOT NULL, duration_days INTEGER NOT NULL, frame TEXT NOT NULL, withdrawal_multiplier REAL NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS vip_memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, level INTEGER NOT NULL, starts_at TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE(telegram_id, level, starts_at));
        CREATE TABLE IF NOT EXISTS piggy_banks (telegram_id TEXT PRIMARY KEY, deposited_micro INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mining_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, started_at TEXT NOT NULL, stopped_at TEXT, claimed_micro INTEGER NOT NULL DEFAULT 0, UNIQUE(telegram_id, started_at));
        CREATE TABLE IF NOT EXISTS treasure_boxes (level INTEGER PRIMARY KEY, name TEXT NOT NULL, cost_micro INTEGER NOT NULL, reward_min_micro INTEGER NOT NULL, reward_max_micro INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS treasure_openings (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, level INTEGER NOT NULL, reward_micro INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS gift_codes (code TEXT PRIMARY KEY, reward_micro INTEGER NOT NULL, max_redemptions INTEGER NOT NULL DEFAULT 1, redeemed_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS gift_redemptions (code TEXT NOT NULL, telegram_id TEXT NOT NULL, redeemed_at TEXT NOT NULL, PRIMARY KEY(code, telegram_id));
        CREATE TABLE IF NOT EXISTS leaderboard_events (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, amount_micro INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS withdrawal_policies (id INTEGER PRIMARY KEY CHECK(id=1), min_micro INTEGER NOT NULL, max_micro INTEGER NOT NULL, daily_max_micro INTEGER NOT NULL, vip_required INTEGER NOT NULL DEFAULT 0, usd_per_sun REAL NOT NULL DEFAULT 0.001, mmk_per_usd REAL NOT NULL DEFAULT 3500, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS sync_legacy_points_to_micro AFTER UPDATE OF points ON users WHEN NEW.sun_micro=OLD.sun_micro AND NEW.points<>OLD.points BEGIN UPDATE users SET sun_micro=OLD.sun_micro+(NEW.points-OLD.points)*1000000 WHERE telegram_id=NEW.telegram_id; END;
      `);
      const settings = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES(?,?,?)");
      settings.run("sun_usd_rate", process.env.SUN_USD_RATE || "0.001", now());
      settings.run("ticker", process.env.TICKER_TEXT || "Keep tapping. Keep growing. Keep shining.", now());
      settings.run("withdrawal_usd_per_sun", process.env.WITHDRAWAL_USD_PER_SUN || "0.001", now());
      db.prepare(`INSERT OR IGNORE INTO withdrawal_policies(id,min_micro,max_micro,daily_max_micro,vip_required,usd_per_sun,mmk_per_usd,updated_at) VALUES(1,?,?,?,?,?,?,?)`)
        .run(Number(process.env.MIN_WITHDRAWAL_MICRO || 1000000000), Number(process.env.MAX_WITHDRAWAL_MICRO || 1000000000000), Number(process.env.DAILY_WITHDRAWAL_MICRO || 2000000000000), Number(process.env.VIP_REQUIRED_FOR_WITHDRAWAL || 0), Number(process.env.WITHDRAWAL_USD_PER_SUN || 0.001), Number(process.env.MMK_PER_USD || 3500), now());
      const vip = db.prepare("INSERT OR IGNORE INTO vip_levels(level,name,price_micro,reward_micro,duration_days,frame,withdrawal_multiplier) VALUES(?,?,?,?,?,?,?)");
      for (let level = 1; level <= 10; level++) vip.run(level, `VIP ${level}`, level * 1000000000, level * 100000000, 30, `frame-${level}`, 1 + level / 10);
      const boxes = db.prepare("INSERT OR IGNORE INTO treasure_boxes(level,name,cost_micro,reward_min_micro,reward_max_micro) VALUES(?,?,?,?,?)");
      for (let level = 1; level <= 10; level++) boxes.run(level, `Treasure Box ${level}`, level * 100000000, level * 50000, level * 300000);
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(2, now());
    })();
  }
}

module.exports = { migrate, MICRO_PER_SUN, MIGRATION_VERSION };
