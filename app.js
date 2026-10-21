(() => {
  "use strict";
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  const $ = (id) => document.getElementById(id);
  let account = null;
  let adminKey = "";
  const api = async (url, options = {}) => {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (tg?.initData) headers["X-Telegram-Init-Data"] = tg.initData;
    if (adminKey) headers["X-Admin-Key"] = adminKey;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  };
  const show = (message, error = false) => {
    const box = $("notice"); box.textContent = message; box.classList.remove("hidden", "error");
    if (error) box.classList.add("error");
    window.setTimeout(() => box.classList.add("hidden"), 4500);
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, action, cls = "secondary") => {
    const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", action); return b;
  };
  const item = (title, description = "") => {
    const wrap = el("div", "item"); wrap.append(el("h4", "", title));
    if (description) wrap.append(el("p", "", description));
    return wrap;
  };
  async function loadMe() {
    if (!tg?.initData) {
      $("connection").textContent = "Open in Telegram";
      show("Open this Mini App from your Telegram bot to sign in.", true);
      return;
    }
    try {
      const data = await api("/api/me"); account = data;
      $("connection").textContent = "Connected";
      $("points").textContent = data.user.points;
      $("greeting").textContent = `Hello, ${data.user.first_name || "SUN"}!`;
      $("energy").textContent = data.user.energy;
      $("energyMax").textContent = data.user.energyMax;
      $("tapPower").textContent = data.user.tapPower;
      $("referrals").textContent = data.referralCount;
      $("seeds").textContent = data.user.seeds;
      $("spinTickets").textContent = data.user.spinTickets;
      $("inventoryTapPower").textContent = data.user.tapPower;
      $("plantGrowth").textContent = data.user.plant.growth;
      $("plantProgress").style.width = `${data.user.plant.growth}%`;
      $("gardenStatus").textContent = data.plantUnlocked ? "Garden unlocked." : "Locked: verify channel membership and invite 3 eligible referrals.";
      $("vipStatus").textContent = data.user.vip ? `VIP active until ${data.user.vipExpiry || "unknown"}.` : "VIP required to request a withdrawal.";
      $("profileName").textContent = data.user.first_name || "Telegram user";
      $("profileUsername").textContent = data.user.username ? `@${data.user.username}` : "No public username";
      $("profileVip").textContent = data.user.vip ? "Active" : "No";
      $("channelStatus").textContent = data.channel.member ? "Verified member" : "Not verified";
      $("referralLink").value = data.referralLink || "";
      $("withdrawPoints").min = data.config.minWithdrawalPoints;
      $("withdrawPoints").value = data.config.minWithdrawalPoints;
      renderLedger(data.ledger || []);
      await Promise.allSettled([loadTasks(), loadSocialLinks(), loadShop()]);
    } catch (e) { $("connection").textContent = "Error"; show(e.message, true); }
  }
  function renderLedger(rows) {
    const root = $("ledger"); root.replaceChildren();
    if (!rows.length) { root.append(el("p", "muted", "No activity yet.")); return; }
    rows.forEach(r => {
      const row = el("div", "item");
      const head = el("div", "item-head");
      head.append(el("strong", "", r.description), el("strong", "", `${r.delta > 0 ? "+" : ""}${r.delta} SUN`));
      row.append(head, el("p", "", new Date(r.created_at).toLocaleString()));
      root.append(row);
    });
  }
  async function loadTasks() {
    const root = $("tasks"); root.replaceChildren();
    const data = await api("/api/tasks");
    if (!data.tasks.length) { root.append(el("p", "muted", "No active tasks yet.")); return; }
    data.tasks.forEach(t => {
      const card = item(t.title, `${t.description || ""} · Reward: ${t.points} SUN`);
      const status = t.claim_status ? `Status: ${t.claim_status}` : "Not submitted";
      card.append(el("p", "", status));
      const actions = el("div", "actions");
      if (t.url) actions.append(button("Open task", () => window.open(t.url, "_blank", "noopener,noreferrer")));
      if (!t.claim_status) actions.append(button("Submit for review", async () => {
        try { await api(`/api/tasks/${encodeURIComponent(t.id)}/claim`, { method: "POST", body: "{}" }); show("Task submitted for review."); await loadTasks(); }
        catch (e) { show(e.message, true); }
      }, "primary"));
      card.append(actions); root.append(card);
    });
  }
  async function loadSocialLinks() {
    const root = $("socialLinks"); root.replaceChildren();
    const data = await api("/api/social-links");
    if (!data.links.length) { root.append(el("p", "muted", "No social links configured.")); return; }
    data.links.forEach(link => {
      const card = item(link.title); card.append(button("Open link", () => window.open(link.url, "_blank", "noopener,noreferrer")));
      root.append(card);
    });
  }
  async function loadShop() {
    const root = $("shopItems"); root.replaceChildren();
    const data = await api("/api/shop");
    data.items.forEach(i => {
      const card = item(i.title, `Cost: ${i.cost} SUN`);
      card.append(button("Buy", async () => {
        try { const result = await api("/api/shop/buy", { method: "POST", body: JSON.stringify({ itemId: i.id }) }); show(result.message); await loadMe(); }
        catch (e) { show(e.message, true); }
      }, "primary")); root.append(card);
    });
  }
  async function action(url, body = {}) {
    try { const d = await api(url, { method: "POST", body: JSON.stringify(body) }); show(d.message || "Success."); await loadMe(); }
    catch (e) { show(e.message, true); }
  }
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("hidden", v.id !== `view-${b.dataset.view}`));
  }));
  $("tapButton").addEventListener("click", async () => {
    try { const d = await api("/api/tap", { method: "POST", body: "{}" }); show(d.message); await loadMe(); }
    catch (e) { show(e.message, true); }
  });
  $("checkinButton").addEventListener("click", () => action("/api/checkin"));
  $("spinButton").addEventListener("click", () => action("/api/spin"));
  $("buySeedButton").addEventListener("click", () => action("/api/plant/buy-seed"));
  $("plantButton").addEventListener("click", () => action("/api/plant/plant"));
  $("waterButton").addEventListener("click", () => action("/api/plant/water"));
  $("harvestButton").addEventListener("click", () => action("/api/plant/harvest"));
  $("verifyPlantButton").addEventListener("click", () => action("/api/plant/verify"));
  $("withdrawButton").addEventListener("click", () => action("/api/withdrawals", {
    points: Number($("withdrawPoints").value), method: $("withdrawMethod").value
  }));
  $("copyReferralButton").addEventListener("click", async () => {
    if (!$("referralLink").value) return show("Referral link unavailable.", true);
    try { await navigator.clipboard.writeText($("referralLink").value); show("Referral link copied."); }
    catch { $("referralLink").select(); show("Select and copy the link manually."); }
  });

  $("showAdminButton").addEventListener("click", () => {
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    $("view-admin").classList.remove("hidden");
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  });
  $("saveAdminKey").addEventListener("click", async () => {
    adminKey = $("adminKey").value.trim();
    try { await loadAdmin(); show("Admin key accepted for this page session."); }
    catch (e) { adminKey = ""; show(e.message, true); }
  });
  $("createTaskButton").addEventListener("click", async () => {
    try {
      await api("/api/admin/tasks", { method: "POST", body: JSON.stringify({
        id: $("newTaskId").value.trim(), title: $("newTaskTitle").value.trim(),
        description: $("newTaskDescription").value.trim(), url: $("newTaskUrl").value.trim(),
        points: Number($("newTaskPoints").value)
      })});
      show("Task created."); await loadAdmin(); await loadTasks();
    } catch (e) { show(e.message, true); }
  });
  $("createLinkButton").addEventListener("click", async () => {
    try {
      await api("/api/admin/social-links", { method: "POST", body: JSON.stringify({
        id: $("newLinkId").value.trim(), title: $("newLinkTitle").value.trim(), url: $("newLinkUrl").value.trim()
      })});
      show("Social link added."); await loadAdmin(); await loadSocialLinks();
    } catch (e) { show(e.message, true); }
  });
  async function loadAdmin() {
    const [tasks, links, claims, withdrawals] = await Promise.all([
      api("/api/admin/tasks"), api("/api/admin/social-links"),
      api("/api/admin/task-claims"), api("/api/admin/withdrawals")
    ]);
    const taskRoot = $("adminTasks"); taskRoot.replaceChildren();
    tasks.tasks.forEach(t => {
      const card = item(`${t.title} (${t.id})`, `${t.points} SUN · ${t.active ? "Active" : "Disabled"}`);
      card.append(button(t.active ? "Disable" : "Enable", async () => {
        try { await api(`/api/admin/tasks/${encodeURIComponent(t.id)}`, { method: "PATCH", body: JSON.stringify({ active: !t.active }) }); await loadAdmin(); await loadTasks(); }
        catch(e) { show(e.message, true); }
      }));
      card.append(button("Delete permanently not available", () => show("Tasks are soft-disabled to preserve claim history.")));
      taskRoot.append(card);
    });
    const linkRoot = $("adminLinks"); linkRoot.replaceChildren();
    links.links.forEach(l => {
      const card = item(l.title, `${l.url} · ${l.active ? "Active" : "Disabled"}`);
      card.append(button(l.active ? "Disable" : "Enable", async () => {
        try { await api(`/api/admin/social-links/${encodeURIComponent(l.id)}`, { method: "PATCH", body: JSON.stringify({ active: !l.active }) }); await loadAdmin(); await loadSocialLinks(); }
        catch(e) { show(e.message, true); }
      }));
      card.append(button("Delete", async () => {
        if (!confirm(`Delete ${l.title}?`)) return;
        try { await api(`/api/admin/social-links/${encodeURIComponent(l.id)}`, { method: "DELETE" }); await loadAdmin(); await loadSocialLinks(); }
        catch(e) { show(e.message, true); }
      }));
      linkRoot.append(card);
    });
    const claimRoot = $("adminClaims"); claimRoot.replaceChildren();
    claims.claims.forEach(c => {
      const card = item(`${c.title || c.task_id} · User ${c.telegram_id}`, `${c.status} · Reward ${c.points ?? "unknown"} SUN`);
      if (c.status === "pending") {
        card.append(button("Approve", async () => { try { await api(`/api/admin/task-claims/${c.id}`, { method: "POST", body: JSON.stringify({status:"approved"}) }); show("Claim approved."); await loadAdmin(); } catch(e) { show(e.message,true); } }, "primary"));
        card.append(button("Reject", async () => { try { await api(`/api/admin/task-claims/${c.id}`, { method: "POST", body: JSON.stringify({status:"rejected"}) }); show("Claim rejected."); await loadAdmin(); } catch(e) { show(e.message,true); } }));
      }
      claimRoot.append(card);
    });
    const wRoot = $("adminWithdrawals"); wRoot.replaceChildren();
    withdrawals.forEach(w => {
      const card = item(`Request #${w.id} · User ${w.telegram_id}`, `${w.points} points · ${w.method} · ${w.status}`);
      if (w.status === "pending") {
        card.append(button("Approve (manual only)", async () => { try { await api(`/api/admin/withdrawals/${w.id}`, {method:"POST",body:JSON.stringify({status:"approved"})}); show("Marked approved; no payment sent."); await loadAdmin(); } catch(e) { show(e.message,true); } }));
        card.append(button("Reject + refund", async () => { try { await api(`/api/admin/withdrawals/${w.id}`, {method:"POST",body:JSON.stringify({status:"rejected"})}); show("Rejected and points refunded."); await loadAdmin(); await loadMe(); } catch(e) { show(e.message,true); } }));
      }
      wRoot.append(card);
    });
  }
  loadMe();
})();
