"use strict";
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrate } = require("../migrations");

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

const rollbackDb = legacyDb();
rollbackDb.prepare("INSERT INTO users VALUES(?,?,?,?)").run("1", "Rollback", 7, new Date().toISOString());
rollbackDb.exec("CREATE TRIGGER fail_migration BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'forced migration failure'); END;");
assert.throws(() => migrate(rollbackDb), /forced migration failure/);
assert.equal(rollbackDb.prepare("PRAGMA table_info(users)").all().some(x => x.name === "sun_micro"), false);
assert.equal(rollbackDb.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n, 0);
rollbackDb.exec("DROP TRIGGER fail_migration");
migrate(rollbackDb);
assert.equal(rollbackDb.prepare("SELECT sun_micro FROM users WHERE telegram_id='1'").get().sun_micro, 7000000);
rollbackDb.prepare("UPDATE users SET sun_micro=sun_micro+1 WHERE telegram_id='1'").run();
assert.equal(rollbackDb.prepare("SELECT sun_micro FROM users WHERE telegram_id='1'").get().sun_micro, 7000001);
console.log("staging migration rollback tests: ok");
