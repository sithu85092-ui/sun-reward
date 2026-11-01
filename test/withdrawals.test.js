"use strict";
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { decideWithdrawal } = require("../withdrawals");

const db = new Database(":memory:");
db.exec(`CREATE TABLE withdrawals(id INTEGER PRIMARY KEY, telegram_id TEXT, amount_micro INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE users(telegram_id TEXT PRIMARY KEY, sun_micro INTEGER NOT NULL);
CREATE TABLE ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT, delta_micro INTEGER, description TEXT, created_at TEXT);`);
db.prepare("INSERT INTO users VALUES(?,?)").run("42", 123000000);
db.prepare("INSERT INTO withdrawals VALUES(?,?,?,?,?)").run(1, "42", 12345, "pending", new Date().toISOString());
const credit = (userId, amount, description) => {
  db.prepare("UPDATE users SET sun_micro=sun_micro+? WHERE telegram_id=?").run(amount, userId);
  db.prepare("INSERT INTO ledger(telegram_id,delta_micro,description,created_at) VALUES(?,?,?,?)").run(userId, amount, description, new Date().toISOString());
};
const result = decideWithdrawal(db, { id: 1, status: "rejected", now: () => new Date().toISOString(), credit });
assert.equal(result.amount_micro, 12345);
assert.equal(db.prepare("SELECT sun_micro FROM users WHERE telegram_id='42'").get().sun_micro, 123012345);
assert.equal(db.prepare("SELECT delta_micro FROM ledger").get().delta_micro, 12345);
assert.throws(() => decideWithdrawal(db, { id: 1, status: "rejected", now: () => new Date().toISOString(), credit }), /already reviewed/);
assert.throws(() => decideWithdrawal(db, { id: 1, status: "approved", now: () => new Date().toISOString(), credit }), /already reviewed/);
db.prepare("INSERT INTO withdrawals VALUES(?,?,?,?,?)").run(2, "42", 777, "pending", new Date().toISOString());
decideWithdrawal(db, { id: 2, status: "approved", now: () => new Date().toISOString(), credit });
assert.throws(() => decideWithdrawal(db, { id: 2, status: "rejected", now: () => new Date().toISOString(), credit }), /already reviewed/);
db.prepare("INSERT INTO withdrawals VALUES(?,?,?,?,?)").run(3, "42", 888, "pending", new Date().toISOString());
assert.throws(() => decideWithdrawal(db, { id: 3, status: "rejected", now: () => new Date().toISOString(), credit: () => { throw new Error("forced credit failure"); } }), /forced credit failure/);
assert.equal(db.prepare("SELECT status FROM withdrawals WHERE id=3").get().status, "pending");
console.log("withdrawal tests: ok");
