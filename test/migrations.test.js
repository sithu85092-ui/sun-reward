"use strict";
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrate, MICRO_PER_SUN, MIGRATION_VERSION } = require("../migrations");

function legacyDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users(telegram_id TEXT PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,delta INTEGER NOT NULL,description TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE withdrawals(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,points INTEGER NOT NULL,method TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE shop_items(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cost INTEGER NOT NULL,category TEXT NOT NULL,effect TEXT NOT NULL,quantity INTEGER NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE shop_purchases(id INTEGER PRIMARY KEY AUTOINCREMENT,telegram_id TEXT NOT NULL,item_id TEXT NOT NULL,cost INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE managed_tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,url TEXT NOT NULL,points INTEGER NOT NULL,verification TEXT NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE referral_rewards(referred_id TEXT PRIMARY KEY,referrer_id TEXT NOT NULL,points INTEGER NOT NULL,created_at TEXT NOT NULL);`);
  return db;
}

const db = legacyDb();
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run("1", "Legacy", 42, new Date().toISOString());
db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)").run("1", 42, "legacy", new Date().toISOString());
migrate(db);
assert.equal(db.prepare("SELECT sun_micro FROM users WHERE telegram_id='1'").get().sun_micro, 42 * MICRO_PER_SUN);
assert.equal(db.prepare("SELECT delta_micro FROM ledger WHERE telegram_id='1'").get().delta_micro, 42 * MICRO_PER_SUN);
assert.equal(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, MIGRATION_VERSION);
const before = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n;
migrate(db);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n, before);
db.prepare("UPDATE users SET sun_micro=sun_micro+1,points=CAST(sun_micro/1000000 AS INTEGER) WHERE telegram_id='1'").run();
assert.equal(db.prepare("SELECT sun_micro FROM users WHERE telegram_id='1'").get().sun_micro, 42000001);
assert.ok(db.prepare("SELECT 1 FROM vip_levels WHERE level=10").get());
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM treasure_boxes").get().n, 10);
assert.equal(MICRO_PER_SUN, 1000000);
assert.equal(Math.floor(0.001 * MICRO_PER_SUN), 1000);
assert.equal(Math.floor(7200 * 0.0001 * MICRO_PER_SUN), 720000);
console.log("migration tests: ok");
