
"use strict";

let adminKey = "";
let withdrawals = [];

const $ = (id) => document.getElementById(id);

function setStatus(id, message, type = "") {
  const element = $(id);
  element.textContent = message;
  element.className = `status ${type}`.trim();
}

async function api(url, options = {}) {
  if (!adminKey) {
    throw new Error("Connect with your admin key first.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "X-Admin-Key": adminKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    },
    cache: "no-store"
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }

  return data;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

function makeCell(value) {
  const cell = document.createElement("td");
  cell.textContent = String(value ?? "—");
  return cell;
}

function renderWithdrawals() {
  const body = $("withdrawals-body");
  body.replaceChildren();

  $("total-count").textContent = String(withdrawals.length);
  $("pending-count").textContent = String(
    withdrawals.filter((item) => item.status === "pending").length
  );

  if (withdrawals.length === 0) {
    const row = document.createElement("tr");
    const cell = makeCell("No withdrawal requests found.");
    cell.colSpan = 7;
    cell.className = "empty";
    row.append(cell);
    body.append(row);
    return;
  }

  for (const item of withdrawals) {
    const row = document.createElement("tr");

    row.append(
      makeCell(item.id),
      makeCell(item.telegram_id),
      makeCell(item.points),
      makeCell(item.method)
    );

    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    const status = String(item.status || "unknown").toLowerCase();

    badge.className = `state ${
      ["pending", "approved", "rejected"].includes(status) ? status : ""
    }`;
    badge.textContent = status;
    statusCell.append(badge);
    row.append(statusCell);

    row.append(makeCell(formatDate(item.created_at)));

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";

    if (status === "pending") {
      const approve = document.createElement("button");
      approve.className = "primary";
      approve.textContent = "Approve";
      approve.addEventListener("click", () => review(item, "approved"));

      const reject = document.createElement("button");
      reject.className = "danger";
      reject.textContent = "Reject";
      reject.addEventListener("click", () => review(item, "rejected"));

      actions.append(approve, reject);
    } else {
      actions.textContent = "Reviewed";
    }

    actionsCell.append(actions);
    row.append(actionsCell);
    body.append(row);
  }
}

async function loadWithdrawals() {
  $("refresh-btn").disabled = true;
  setStatus("connection-status", "Loading withdrawal requests...");

  try {
    const data = await api("/api/admin/withdrawals");

    if (!Array.isArray(data)) {
      throw new Error("Unexpected response from the server.");
    }

    withdrawals = data;
    renderWithdrawals();
    setStatus("connection-status", "Connected successfully.", "success");
  } finally {
    $("refresh-btn").disabled = false;
  }
}

async function review(item, status) {
  const action = status === "approved" ? "approve" : "reject";

  const warning = status === "approved"
    ? `Approve request #${item.id}?\nThis does NOT transfer money.`
    : `Reject request #${item.id}?\nThe server should refund the points.`;

  if (!window.confirm(warning)) return;

  try {
    await api(`/api/admin/withdrawals/${encodeURIComponent(item.id)}`, {
      method: "POST",
      body: JSON.stringify({ status })
    });

    setStatus(
      "connection-status",
      `Request #${item.id}: ${action}d successfully. Status only; no payout occurred.`,
      "success"
    );

    await loadWithdrawals();
  } catch (error) {
    setStatus("connection-status", error.message, "error");
  }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const enteredKey = $("admin-key").value;
  $("admin-key").value = "";

  if (!enteredKey) {
    setStatus("connection-status", "Enter your admin key.", "error");
    return;
  }

  adminKey = enteredKey;

  try {
    await loadWithdrawals();
  } catch (error) {
    adminKey = "";
    withdrawals = [];
    renderWithdrawals();
    setStatus(
      "connection-status",
      `${error.message} Check your key and server configuration.`,
      "error"
    );
  }
});

$("logout-btn").addEventListener("click", () => {
  adminKey = "";
  withdrawals = [];
  renderWithdrawals();

  $("pending-count").textContent = "—";
  $("total-count").textContent = "—";

  setStatus("connection-status", "Disconnected.");
});

$("refresh-btn").addEventListener("click", async () => {
  try {
    await loadWithdrawals();
  } catch (error) {
    setStatus("connection-status", error.message, "error");
  }
});

$("vip-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const telegramId = $("telegram-id").value.trim();
  const days = Number($("vip-days").value);

  if (!/^\d{1,20}$/.test(telegramId)) {
    setStatus("vip-result", "Enter a valid numeric Telegram ID.", "error");
    return;
  }

  if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
    setStatus("vip-result", "Invalid VIP duration.", "error");
    return;
  }

  if (!window.confirm(
    `Grant ${days} days of VIP to Telegram user ${telegramId}?`
  )) {
    return;
  }

  try {
    const result = await api(
      `/api/admin/users/${encodeURIComponent(telegramId)}/vip`,
      {
        method: "POST",
        body: JSON.stringify({ days })
      }
    );

    setStatus(
      "vip-result",
      `VIP updated for ${result.telegram_id}. Expiry: ${formatDate(result.vip_until)}. No payment was processed.`,
      "success"
    );
  } catch (error) {
    setStatus("vip-result", error.message, "error");
  }
});

renderWithdrawals();
