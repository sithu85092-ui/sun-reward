
"use strict";

const tg = window.Telegram?.WebApp;
const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  config: {
    referralPoints: 50,
    minWithdrawalPoints: 1000
  },
  demoMode: !tg || !tg.initData,
  loading: false,
  walletConnected: false,
  shopFilter: "all"
};

if (tg) {
  tg.ready();
  tg.expand();
}

function toast(message) {
  const el = $("toast");
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = String(message);
  el.classList.add("show");

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.classList.remove("show");
  }, 2800);
}

async function api(path, options = {}) {
  if (state.demoMode) {
    throw new Error(
      "Preview mode သာဖြစ်ပါတယ်။ Telegram ထဲက Mini App မှာ ဖွင့်ပါ။"
    );
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Telegram-Init-Data": tg.initData,
    ...(options.headers || {})
  };

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({
    error: "Server response ကို ဖတ်မရပါ။"
  }));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function demoUser() {
  const user = tg?.initDataUnsafe?.user;

  return user
    ? {
        id: user.id,
        first_name: user.first_name || "Friend",
        username: user.username || "",
        photo_url: user.photo_url || ""
      }
    : {
        id: "Preview",
        first_name: "Demo User",
        username: "",
        photo_url: ""
      };
}

function setText(id, value) {
  const el = $(id);
  if (el) {
    el.textContent = value == null ? "" : String(value);
  }
}

function setValue(id, value) {
  const el = $(id);
  if (el) {
    el.value = value == null ? "" : String(value);
  }
}

function showError(error) {
  toast(error?.message || "တစ်ခုခု မှားယွင်းနေပါတယ်။");
}

function showPanel(name) {
  const panel = $(name);
  if (!panel) return;

  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === name);
  });

  document.querySelectorAll(".panel").forEach((section) => {
    section.classList.toggle("hidden", section.id !== name);
  });

  if (name === "wallet") {
    refreshWithdrawalEligibility();
  }

  if (name === "vip") {
    refreshVip();
  }

  if (name === "shop") {
    loadShop();
  }

  if (name === "plant") {
    renderPlant();
  }

  if (name === "game") {
    renderGame();
  }
}

function renderProfile(user) {
  const fallback = demoUser();
  const name = user?.first_name || fallback.first_name;
  const photo = user?.photo_url || fallback.photo_url || "";
  const id = user?.id ?? fallback.id;

  setText("profile-name", name);
  setText("profile-id", id);
  setText("profile-username", user?.username
    ? `@${user.username}`
    : "Not available");
  setText("profile-points", user?.points ?? 0);

  const image = $("profile-photo");
  const avatar = $("profile-avatar");

  if (image && avatar && photo.startsWith("https://")) {
    image.src = photo;
    image.hidden = false;
    avatar.hidden = true;
  } else if (image && avatar) {
    image.hidden = true;
    avatar.hidden = false;
  }

  setText(
    "profile-created",
    user?.created_at
      ? new Date(user.created_at).toLocaleDateString()
      : "Available after account details are configured"
  );
}

function renderTasks(tasks) {
  const container = $("task-list");
  if (!container) return;

  container.replaceChildren();

  if (!Array.isArray(tasks) || tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card muted";
    empty.textContent = "လက်ရှိ Task မရှိသေးပါ။";
    container.append(empty);
    return;
  }

  tasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = "card task";

    const left = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = task.title || "Task";

    const description = document.createElement("p");
    description.textContent = task.description || "";

    left.append(title, description);

    const right = document.createElement("div");
    right.style.textAlign = "right";

    const reward = document.createElement("div");
    reward.className = "reward";
    reward.textContent = `+${Number(task.points) || 0} SUN`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = task.completed ? "Done" : "Claim";
    button.disabled = Boolean(task.completed);

    button.addEventListener("click", async () => {
      try {
        await api(
          `/api/tasks/${encodeURIComponent(task.id)}/claim`,
          {
            method: "POST",
            body: "{}"
          }
        );

        toast("Task claim အောင်မြင်ပါပြီ။");
        await refresh();
      } catch (error) {
        showError(error);
      }
    });

    right.append(reward, button);
    card.append(left, right);
    container.append(card);
  });
}

function renderLedger(rows) {
  const container = $("ledger");
  if (!container) return;

  container.replaceChildren();

  if (!Array.isArray(rows) || rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card muted";
    empty.textContent = "လှုပ်ရှားမှု မှတ်တမ်းမရှိသေးပါ။";
    container.append(empty);
    return;
  }

  rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "ledger-row";

    const description = document.createElement("span");
    description.textContent = row.description || "Activity";

    const amount = document.createElement("strong");
    const delta = Number(row.delta) || 0;
    amount.textContent = `${delta > 0 ? "+" : ""}${delta}`;

    line.append(description, amount);
    container.append(line);
  });
}

function renderReferral(data) {
  const link = data?.referralLink || data?.referral_link || "";

  setValue(
    "ref-link",
    link || "Referral link ကို Backend မှာ ပြင်ဆင်ရန်လိုပါတယ်။"
  );

  setText(
    "ref-points",
    data?.config?.referralPoints ?? state.config.referralPoints
  );

  const count = Number(
    data?.user?.referral_count ?? data?.referralCount ?? 0
  );

  setText("ref-count", count);

  const progress = $("ref-progress");
  if (progress) {
    progress.value = Math.min(count, 3);
    progress.max = 3;
  }

  setText(
    "ref-status",
    count >= 3
      ? "အရေအတွက် ပြည့်ပါပြီ။ Channel membership ကိုပါ စစ်ဆေးရပါမယ်။"
      : `Feature အချို့အတွက် eligible referrals ${3 - count} ယောက် ထပ်လိုပါသေးတယ်။`
  );
}

function renderGame() {
  setText("energy", state.me?.energy ?? "Backend မချိတ်ရသေး");
  setText("energy-max", state.me?.energyMax ?? "—");
  setText("tap-power", state.me?.tapPower ?? 1);

  const bar = $("energy-bar");
  if (bar) {
    const max = Number(state.me?.energyMax) || 100;
    const energy = Number(state.me?.energy) || 0;
    bar.max = max;
    bar.value = Math.min(energy, max);
  }
}

function renderPlant(data = {}) {
  const plant = data.plant || state.me?.plant || null;
  const unlocked = Boolean(data.plantUnlocked ?? plant?.unlocked);

  const lock = $("plant-lock");
  const actions = $("plant-actions");

  if (lock) lock.classList.toggle("hidden", unlocked);
  if (actions) actions.classList.toggle("hidden", !unlocked);

  setText(
    "plant-stage",
    plant?.stage || "Garden feature အတွက် Backend လိုအပ်ပါတယ်။"
  );
  setText("plant-growth", `${Number(plant?.growth) || 0}%`);

  const progress = $("plant-progress");
  if (progress) {
    progress.max = 100;
    progress.value = Math.min(100, Number(plant?.growth) || 0);
  }

  setText("plant-lock-message", unlocked
    ? "Garden ဖွင့်ပြီးပါပြီ။"
    : "လိုအပ်ချက်များကို Server က စစ်ဆေးရပါမယ်။");
}

function refreshWithdrawalEligibility() {
  const isVip = Boolean(state.me?.vip);
  const text = isVip
    ? "VIP status ကို Server မှာ အတည်ပြုရန်လိုပါတယ်။"
    : "သင့်အကောင့် VIP အခြေအနေကို Server မှာ စစ်ဆေးရပါမယ်။";

  setText("withdraw-eligibility", text);
}

function refreshVip() {
  setText(
    "vip-status",
    state.me?.vip ? "VIP (server verification required)" : "Standard member"
  );
  setText("vip-expiry", state.me?.vipExpiry || "—");
}

function loadShop() {
  const shop = $("shop-list");
  const inventory = $("inventory-list");

  if (shop) {
    shop.replaceChildren();
    const card = document.createElement("div");
    card.className = "card";
    card.textContent =
      "Shop purchase ကို လုံခြုံစွာအသုံးပြုရန် Server API နှင့် inventory စနစ် ထပ်တည်ဆောက်ရန်လိုပါတယ်။";
    shop.append(card);
  }

  if (inventory) {
    inventory.replaceChildren();
    const card = document.createElement("div");
    card.className = "card muted";
    card.textContent = "Inventory API မချိတ်ဆက်ရသေးပါ။";
    inventory.append(card);
  }
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;

  try {
    if (state.demoMode) {
      const user = demoUser();
      state.me = user;

      setText("hello", `Hello, ${user.first_name} · Preview mode`);
      setText("points", "0");
      setText("account-status", "Preview mode — အမှန်တကယ် Point မရရှိပါ။");
      setText("tap-message", "Preview သာဖြစ်ပါတယ်။ Server ချိတ်ဆက်ရန်လိုပါတယ်။");

      renderProfile(user);
      renderTasks([
        {
          id: "preview",
          title: "Preview task",
          description: "Demo အတွက်သာဖြစ်ပြီး Point မပေးပါ။",
          points: 0,
          completed: false
        }
      ]);
      renderLedger([]);
      renderReferral({});
      renderGame();
      renderPlant();

      setText("withdraw-eligibility", "Preview mode");
      setText("vip-status", "Preview mode");
      return;
    }

    const data = await api("/api/me");
    state.me = data.user || {};
    state.config = data.config || state.config;

    setText(
      "hello",
      `Hello, ${state.me.first_name || "friend"}`
    );
    setText("points", state.me.points ?? 0);
    setText("account-status", "အကောင့်အချက်အလက် ရရှိပါပြီ။");

    renderProfile(state.me);
    renderTasks(data.tasks || []);
    renderLedger(data.ledger || []);
    renderReferral(data);
    renderGame();
    renderPlant(data);

    setText("withdraw-eligibility", "Server verification လိုအပ်ပါတယ်။");
  } catch (error) {
    setText("hello", "Server နဲ့ ချိတ်ဆက်မရပါ။");
    setText(
      "account-status",
      "Connection error ဖြစ်နေပါတယ်။ Network နဲ့ Backend ကို စစ်ဆေးပါ။"
    );
    showError(error);
  } finally {
    state.loading = false;
  }
}

async function checkin() {
  try {
    const result = await api("/api/checkin", {
      method: "POST",
      body: "{}"
    });

    toast(result.message || "Daily check-in အောင်မြင်ပါပြီ။");
    await refresh();
  } catch (error) {
    showError(error);
  }
}

async function copyReferral() {
  const input = $("ref-link");
  const value = input?.value || "";

  if (!value || value.includes("Backend")) {
    toast("Referral link မရရှိသေးပါ။");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      toast("Referral link ကို Copy လုပ်ပြီးပါပြီ။");
    } else {
      input.select();
      toast("Link ကို Select လုပ်ပြီး Copy လုပ်ပါ။");
    }
  } catch {
    input.select();
    toast("Link ကို Select လုပ်ပြီး Copy လုပ်ပါ။");
  }
}

async function submitWithdrawal() {
  try {
    if (!state.me?.vip) {
      toast("Withdrawal အတွက် VIP eligibility ကို Server မှာ အတည်ပြုရပါမယ်။");
      return;
    }

    const points = Number($("withdraw-points")?.value);
    const method = $("withdraw-method")?.value || "manual_review";

    if (!Number.isSafeInteger(points) || points <= 0) {
      throw new Error("Point ပမာဏ မှန်ကန်စွာ ထည့်ပါ။");
    }

    const result = await api("/api/withdrawals", {
      method: "POST",
      body: JSON.stringify({ points, method })
    });

    setText(
      "withdraw-note",
      result.message || "Request ကို ပေးပို့ပြီးပါပြီ။"
    );

    toast("Withdrawal request ပေးပို့ပြီးပါပြီ။");
    await refresh();
  } catch (error) {
    showError(error);
  }
}

async function unavailableFeature(label) {
  toast(
    `${label}: ဒီ Feature အတွက် Backend API မတည်ဆောက်ရသေးပါ။`
  );
}

async function verifyPlant() {
  try {
    const result = await api("/api/plant/verify", {
      method: "POST",
      body: "{}"
    });

    renderPlant(result);
    toast(result.message || "Requirement စစ်ဆေးပြီးပါပြီ။");
  } catch (error) {
    showError(error);
  }
}

async function plantAction(action) {
  const routes = {
    "buy-seed": "/api/plant/buy-seed",
    "plant-seed": "/api/plant/plant",
    "water-plant": "/api/plant/water",
    "harvest-plant": "/api/plant/harvest"
  };

  const route = routes[action];
  if (!route) return;

  try {
    const result = await api(route, {
      method: "POST",
      body: "{}"
    });

    toast(result.message || "Garden action ပြီးပါပြီ။");
    await refresh();
  } catch (error) {
    showError(error);
  }
}

async function tapSun() {
  try {
    const result = await api("/api/tap", {
      method: "POST",
      body: "{}"
    });

    setText(
      "tap-message",
      result.message || `+${Number(result.earned) || 0} SUN`
    );
    await refresh();
  } catch (error) {
    showError(error);
  }
}

async function spin() {
  try {
    const result = await api("/api/spin", {
      method: "POST",
      body: "{}"
    });

    setText(
      "spin-result",
      result.message || "Spin result ကို ရရှိပါပြီ။"
    );

    await refresh();
  } catch (error) {
    showError(error);
  }
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      showPanel(button.dataset.tab);
    });
  });

  document.querySelectorAll("[data-open-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      showPanel(button.dataset.openTab);
    });
  });

  $("checkin")?.addEventListener("click", checkin);
  $("copy-ref")?.addEventListener("click", copyReferral);
  $("withdraw")?.addEventListener("click", submitWithdrawal);
  $("verify-plant")?.addEventListener("click", verifyPlant);
  $("tap-button")?.addEventListener("click", tapSun);
  $("spin-button")?.addEventListener("click", spin);

  ["buy-seed", "plant-seed", "water-plant", "harvest-plant"]
    .forEach((id) => {
      $(id)?.addEventListener("click", () => plantAction(id));
    });

  $("task-refresh")?.addEventListener("click", refresh);
  $("vip-refresh")?.addEventListener("click", refreshVip);

  $("connect-wallet")?.addEventListener("click", () => {
    toast(
      "TON Wallet ချိတ်ဆက်မှုအတွက် TON Connect ကို သီးခြားတပ်ဆင်ရန်လိုပါတယ်။ Seed phrase မထည့်ပါနဲ့။"
    );
  });

  $("disconnect-wallet")?.addEventListener("click", () => {
    state.walletConnected = false;
    setText("wallet-status", "Not connected");
    toast("Wallet ချိတ်ဆက်မှု မရှိပါ။");
  });

  $("language-btn")?.addEventListener("click", () => {
    toast("Language switch ကို နောက်အဆင့်မှာ ထည့်သွင်းပါမယ်။");
  });

  document.querySelectorAll("[data-shop-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.shopFilter = button.dataset.shopFilter;
      loadShop();
    });
  });

  $("required-channel")?.addEventListener("click", (event) => {
    const link = event.currentTarget.href;
    if (!link || link.endsWith("#")) {
      event.preventDefault();
      toast("Required channel link ကို Server configuration မှာ ထည့်ရန်လိုပါတယ်။");
    }
  });
}

bindEvents();
refresh();
