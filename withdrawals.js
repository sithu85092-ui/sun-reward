"use strict";

function decideWithdrawal(db, { id, status, now, credit }) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid request ID.");
  if (!["approved", "rejected"].includes(status)) throw new Error("Status must be approved or rejected.");
  return db.transaction(() => {
    const withdrawal = db.prepare("SELECT * FROM withdrawals WHERE id=?").get(id);
    if (!withdrawal) throw new Error("Request not found.");
    if (withdrawal.status !== "pending") throw new Error("Request already reviewed.");
    const amount = Number(withdrawal.amount_micro);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Withdrawal has no valid micro-SUN amount.");
    db.prepare("UPDATE withdrawals SET status=? WHERE id=? AND status='pending'").run(status, id);
    if (status === "rejected") credit(withdrawal.telegram_id, amount, `Refund for rejected request #${id}`);
    return { status, amount_micro: amount };
  })();
}

module.exports = { decideWithdrawal };
