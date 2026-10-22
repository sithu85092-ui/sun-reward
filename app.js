(() => {
  'use strict';
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#07130e'); tg.setBackgroundColor('#07130e'); } catch {} }
  const $ = (id) => document.getElementById(id);
  let account = null;
  let adminKey = '';
  let tonUI = null;
  let tonManifestUrl = '';
  let walletStatusUnsubscribe = null;
  let walletSyncInProgress = false;
  const api = async (url, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (tg?.initData) headers['X-Telegram-Init-Data'] = tg.initData;
    if (adminKey) headers['X-Admin-Key'] = adminKey;
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  };
  const show = (message, error = false) => {
    const box = $('notice'); if (!box) return;
    box.textContent = message; box.classList.remove('hidden', 'error');
    if (error) box.classList.add('error');
    window.clearTimeout(show.timer); show.timer = window.setTimeout(() => box.classList.add('hidden'), 4200);
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag); if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text; return n;
  };
  const button = (text, action, cls = 'button button-secondary') => {
    const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', action); return b;
  };
  const itemCard = (title, description = '') => {
    const wrap = el('article', 'item-card'); wrap.append(el('h3', '', title));
    if (description) wrap.append(el('p', '', description)); return wrap;
  };
  const safeExternal = (url) => {
    try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.href : null; } catch { return null; }
  };
  function setView(name) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${name}`));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderLedger(rows) {
    const root = $('ledger'); root.replaceChildren();
    if (!rows.length) { root.append(el('p', 'empty-state', 'No activity yet. Your first SUN reward will appear here.')); return; }
    rows.forEach(r => {
      const row = el('div', 'activity-row'); const head = el('div', 'activity-row-head');
      head.append(el('strong', '', r.description), el('strong', `delta${r.delta < 0 ? ' negative' : ''}`, `${r.delta > 0 ? '+' : ''}${r.delta} SUN`));
      row.append(head, el('small', '', new Date(r.created_at).toLocaleString())); root.append(row);
    });
  }
  async function loadTasks() {
    const root = $('tasks'); root.replaceChildren();
    const data = await api('/api/tasks');
    if (!data.tasks.length) { root.append(el('p', 'empty-state', 'No active tasks yet. Check back soon.')); return; }
    data.tasks.forEach(t => {
      const card = itemCard(t.title, t.description || 'Complete this mission to earn SUN.');
      const meta = el('div', 'item-meta', `✦ ${t.points} SUN reward`); card.append(meta);
      const statusText = ({ pending: 'Pending admin review', approved: 'Reward approved', rejected: 'Submission rejected' })[t.claim_status] || 'Not submitted';
      card.append(el('div', 'item-status', statusText));
      const actions = el('div', 'actions'); const safeUrl = t.url ? safeExternal(t.url) : null;
      if (safeUrl) actions.append(button('Open task ↗', () => window.open(safeUrl, '_blank', 'noopener,noreferrer')));
      if (!t.claim_status || t.claim_status === 'rejected') actions.append(button('Submit for review', async () => {
        try { await api(`/api/tasks/${encodeURIComponent(t.id)}/claim`, { method: 'POST', body: '{}' }); show('Task submitted for review.'); await loadTasks(); }
        catch (e) { show(e.message, true); }
      }, 'button button-primary'));
      if (actions.childElementCount) card.append(actions); root.append(card);
    });
  }
  async function loadSocialLinks() {
    const root = $('socialLinks'); root.replaceChildren();
    const data = await api('/api/social-links');
    if (!data.links.length) { root.append(el('p', 'empty-state', 'No social channels have been configured by admin yet.')); return; }
    data.links.forEach(link => {
      const card = itemCard(link.title, 'Visit our official community channel.');
      const url = safeExternal(link.url); if (url) card.append(button('Open channel ↗', () => window.open(url, '_blank', 'noopener,noreferrer')));
      root.append(card);
    });
  }
  const shopIcons = { seed: '🌱', spin_ticket: '🎟️', tap_upgrade: '⚡', tap_upgrade_5: '🚀', energy_refill: '🔋' };
  async function buyItem(id) {
    try { const requestId = (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
      const result = await api('/api/shop/buy', { method: 'POST', body: JSON.stringify({ itemId: id, requestId }) }); show(result.message || 'Purchase complete.'); await loadMe(); }
    catch (e) { show(e.message, true); }
  }
  async function loadShop() {
    const root = $('shopItems'), upgrades = $('upgradeCards'); root.replaceChildren(); upgrades.replaceChildren();
    const data = await api('/api/shop');
    const items = data.items || [];
    const regular = items.filter(i => i.category !== 'upgrade');
    const upgradeItems = items.filter(i => i.category === 'upgrade');
    if (!regular.length) root.append(el('p', 'empty-state', 'The shop is empty. Ask admin to configure items.'));
    regular.forEach(i => {
      const card = el('article', 'shop-item');
      card.append(el('div', 'shop-item-art', shopIcons[i.id] || '✦'), el('h3', '', i.title), el('p', '', i.description || 'Useful item for your SUN REWARD journey.'));
      const price = el('div', 'shop-price'); price.append(el('strong', '', `${i.cost} SUN`), el('small', '', 'ONE-TIME')); card.append(price);
      card.append(button('Buy item', () => buyItem(i.id), 'button button-primary')); root.append(card);
    });
    if (!upgradeItems.length) upgrades.append(el('p', 'empty-state', 'No upgrades available.'));
    const inventoryRoot = $('inventoryOtherItems');
    if (inventoryRoot) {
      inventoryRoot.replaceChildren();
      const owned = data.inventory?.items || [];
      const extras = owned.filter(i => !['seed', 'spin_ticket', 'tap_upgrade', 'tap_upgrade_5'].includes(i.itemId));
      if (extras.length) {
        inventoryRoot.append(el('h3', 'inventory-extra-title', 'Other owned items'));
        extras.forEach(i => inventoryRoot.append(el('div', 'activity-row', `${i.title || i.itemId} × ${i.quantity}`)));
      }
    }
    upgradeItems.forEach(i => {
      const card = el('article', 'upgrade-card');
      card.append(el('div', 'upgrade-art', shopIcons[i.id] || '✦'), el('h3', '', i.title), el('p', '', i.description || 'Upgrade your player stats.'), el('span', 'level-pill', 'PERMANENT UPGRADE'));
      const price = el('div', 'shop-price'); price.append(el('strong', '', `${i.cost} SUN`), el('small', '', 'UPGRADE')); card.append(price);
      card.append(button('Unlock upgrade', () => buyItem(i.id), 'button button-primary')); upgrades.append(card);
    });
  }
  async function loadWallet() {
    try {
      const data = await api('/api/wallet');
      renderWallet(data.wallet || {});
    } catch (e) { console.warn('Wallet status unavailable:', e.message); }
  }
  function shortAddress(address) {
    if (!address) return '';
    return address.length > 22 ? `${address.slice(0, 8)}…${address.slice(-8)}` : address;
  }
  function renderWallet(wallet = {}) {
    const address = wallet.address || '';
    $('walletTitle').textContent = address ? 'TON wallet connected' : 'Connect TON wallet';
    $('walletDescription').textContent = address ? `Connected address: ${shortAddress(address)}` : 'Link your TON wallet address to your SUN REWARD profile.';
    $('walletStatus').textContent = address ? 'Connected' : 'Not connected';
    $('walletStatus').classList.toggle('connected', Boolean(address));
    $('disconnectWalletButton').classList.toggle('hidden', !address);
  }
  async function initTonConnect() {
    try {
      const cfg = await fetch('/api/public-config').then(r => r.json());
      tonManifestUrl = cfg.tonConnectManifestUrl || '';
      if (!tonManifestUrl || !window.TON_CONNECT_UI?.TonConnectUI) {
        $('tonConnectButton').replaceChildren();
        $('tonConnectButton').append(el('p', 'helper-text', !tonManifestUrl ? 'Wallet setup error: the server did not provide a manifest URL. Check /api/public-config.' : 'TON Connect library did not load. Check internet access / CDN blocking, then reload the Mini App.'));
        console.error('TON Connect unavailable', { manifestUrl: tonManifestUrl, libraryLoaded: Boolean(window.TON_CONNECT_UI?.TonConnectUI) });
        return;
      }
      tonUI = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: tonManifestUrl, buttonRootId: 'tonConnectButton' });
      walletStatusUnsubscribe = tonUI.onStatusChange(async wallet => {
        if (!wallet?.account?.address || walletSyncInProgress) return;
        walletSyncInProgress = true;
        try {
          await api('/api/wallet/connect', { method: 'POST', body: JSON.stringify({ address: wallet.account.address, chain: String(wallet.account.chain || '') }) });
          renderWallet({ address: wallet.account.address, chain: wallet.account.chain });
          show('TON wallet connected to your profile.');
        } catch (e) { show(e.message, true); }
        finally { walletSyncInProgress = false; }
      });
      const current = tonUI.wallet;
      if (current?.account?.address) {
        try { await api('/api/wallet/connect', { method: 'POST', body: JSON.stringify({ address: current.account.address, chain: String(current.account.chain || '') }) }); renderWallet({ address: current.account.address }); } catch {}
      }
    } catch (e) { console.warn('TON Connect setup failed:', e); const root = $('tonConnectButton'); if (root) { root.replaceChildren(); root.append(el('p', 'helper-text', `Wallet connection failed: ${e.message || 'check public HTTPS manifest and TON Connect availability'}`)); } }
  }
  async function loadMe() {
    if (!tg?.initData) {
      $('connection').textContent = 'Open in Telegram'; $('connection').classList.add('error');
      show('Open this Mini App from your Telegram bot to sign in securely.', true); return;
    }
    try {
      const data = await api('/api/me'); account = data;
      $('connection').innerHTML = '<i></i> Connected'; $('connection').classList.remove('error'); $('connection').classList.add('connected');
      const user = data.user;
      $('points').textContent = Number(user.points || 0).toLocaleString();
      $('shopBalance').textContent = Number(user.points || 0).toLocaleString();
      $('greeting').textContent = user.first_name || 'SUN Player';
      $('energy').textContent = user.energy; $('energyMax').textContent = user.energyMax;
      $('tapEnergy').textContent = `${user.energy}/${user.energyMax}`;
      $('energyBar').style.width = `${Math.max(0, Math.min(100, 100 * user.energy / Math.max(1, user.energyMax)))}%`;
      $('tapPower').innerHTML = `${user.tapPower} <em>SUN/tap</em>`;
      $('tapHint').textContent = `+${user.tapPower} SUN per tap`;
      $('referrals').textContent = data.referralCount || 0; $('walletReferrals').textContent = `${data.referralCount || 0} friends`;
      $('seeds').innerHTML = `${user.seeds} <em>in bag</em>`; $('inventorySeeds').textContent = user.seeds;
      $('spinTickets').textContent = user.spinTickets; $('inventoryTapPower').textContent = user.tapPower;
      $('plantGrowth').textContent = user.plant.growth; $('plantProgress').style.width = `${user.plant.growth}%`;
      $('gardenStatus').textContent = data.plantUnlocked ? (user.plant.stage ? (user.plant.growth >= 100 ? 'Your plant is ready!' : 'Your plant is growing') : 'Your garden is unlocked') : 'Garden is locked';
      $('gardenSubStatus').textContent = data.plantUnlocked ? (user.plant.stage ? 'Keep watering until it reaches 100%.' : `${user.seeds} seed(s) available to plant.`) : `Join ${data.config.requiredChannel || 'the required channel'} and invite ${data.config.minPlantReferrals} eligible friends.`;
      $('gardenPlantArt').classList.toggle('growing', user.plant.stage > 0 && user.plant.growth > 0);
      $('gardenPlantArt').classList.toggle('ready', user.plant.stage > 0 && user.plant.growth >= 100);
      $('gardenPlantArt').style.opacity = user.plant.stage > 0 ? '1' : '.55';
      $('gardenPlantArt').style.transform = user.plant.stage > 0 ? 'translateX(-50%) scale(1)' : 'translateX(-50%) scale(.72)';
      $('vipStatus').textContent = user.vip ? `VIP active until ${user.vipExpiry || 'expiry unavailable'}.` : 'VIP membership required to request a withdrawal.';
      $('profileName').textContent = user.first_name || 'Telegram user'; $('profileUsername').textContent = user.username ? `@${user.username}` : 'No public username';
      $('profileNameAlt').textContent = user.first_name || 'Telegram user'; $('profileUsernameAlt').textContent = user.username ? `@${user.username}` : 'No public username';
      const initial = (user.first_name || 'S').trim().charAt(0).toUpperCase();
      $('profileAvatar').textContent = initial; $('profileAvatarLarge').textContent = initial; $('profileAvatarLargeAlt').textContent = initial;
      $('profileVip').textContent = user.vip ? 'VIP ACTIVE' : 'NO VIP'; $('profileVip').classList.toggle('active', Boolean(user.vip));
      $('profileVipAlt').textContent = user.vip ? 'VIP ACTIVE' : 'NO VIP'; $('profileVipAlt').classList.toggle('active', Boolean(user.vip));
      $('channelStatus').textContent = data.channel.member ? 'Verified member' : 'Not verified'; $('channelStatusAlt').textContent = data.channel.member ? 'Verified member' : 'Not verified';
      $('accountCreated').textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '—';
      $('referralLink').value = data.referralLink || '';
      $('withdrawPoints').min = data.config.minWithdrawalPoints;
      if (!$('withdrawPoints').dataset.touched) $('withdrawPoints').value = data.config.minWithdrawalPoints;
      renderLedger(data.ledger || []);
      await Promise.allSettled([loadTasks(), loadSocialLinks(), loadShop(), loadWallet()]);
    } catch (e) { $('connection').textContent = 'Connection error'; $('connection').classList.add('error'); show(e.message, true); }
  }
  async function action(url, body = {}) {
    try { const d = await api(url, { method: 'POST', body: JSON.stringify(body) }); show(d.message || 'Success.'); await loadMe(); }
    catch (e) { show(e.message, true); }
  }
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => setView(b.dataset.goto)));
  $('profileAvatar').addEventListener('click', () => setView('profile'));
  $('tapButton').addEventListener('click', async () => {
    try { const d = await api('/api/tap', { method: 'POST', body: '{}' }); show(d.message || `+${d.earned} SUN`); await loadMe(); }
    catch (e) { show(e.message, true); }
  });
  $('checkinButton').addEventListener('click', () => action('/api/checkin'));
  $('spinButton').addEventListener('click', () => action('/api/spin'));
  $('buySeedButton').addEventListener('click', () => buyItem('seed'));
  $('plantButton').addEventListener('click', () => action('/api/plant/plant'));
  $('waterButton').addEventListener('click', () => action('/api/plant/water'));
  $('harvestButton').addEventListener('click', () => action('/api/plant/harvest'));
  $('verifyPlantButton').addEventListener('click', () => action('/api/plant/verify'));
  $('withdrawPoints').addEventListener('input', () => { $('withdrawPoints').dataset.touched = '1'; });
  $('withdrawButton').addEventListener('click', () => action('/api/withdrawals', { points: Number($('withdrawPoints').value), method: $('withdrawMethod').value }));
  $('copyReferralButton').addEventListener('click', async () => {
    if (!$('referralLink').value) return show('Referral link unavailable. Set BOT_USERNAME in server settings.', true);
    try { await navigator.clipboard.writeText($('referralLink').value); show('Referral link copied.'); }
    catch { $('referralLink').select(); show('Select and copy the link manually.'); }
  });
  $('disconnectWalletButton').addEventListener('click', async () => {
    try {
      if (tonUI) await tonUI.disconnect();
      await api('/api/wallet/disconnect', { method: 'POST', body: '{}' }); renderWallet({}); show('Wallet disconnected from your SUN REWARD profile.');
    } catch (e) { show(e.message, true); }
  });
  $('showAdminButton').addEventListener('click', () => setView('admin'));
  $('saveAdminKey').addEventListener('click', async () => {
    adminKey = $('adminKey').value.trim();
    try { await loadAdmin(); show('Admin tools unlocked for this page session.'); }
    catch (e) { adminKey = ''; show(e.message, true); }
  });
  $('createTaskButton').addEventListener('click', async () => {
    try {
      await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify({ id: $('newTaskId').value.trim(), title: $('newTaskTitle').value.trim(), description: $('newTaskDescription').value.trim(), url: $('newTaskUrl').value.trim(), points: Number($('newTaskPoints').value) }) });
      show('Task created.'); await loadAdmin(); await loadTasks();
    } catch (e) { show(e.message, true); }
  });
  $('createLinkButton').addEventListener('click', async () => {
    try {
      await api('/api/admin/social-links', { method: 'POST', body: JSON.stringify({ id: $('newLinkId').value.trim(), title: $('newLinkTitle').value.trim(), url: $('newLinkUrl').value.trim() }) });
      show('Social link added.'); await loadAdmin(); await loadSocialLinks();
    } catch (e) { show(e.message, true); }
  });
  $('createShopItemButton').addEventListener('click', async () => {
    const payload = {
      id: $('newShopItemId').value.trim(), title: $('newShopItemTitle').value.trim(),
      description: $('newShopItemDescription').value.trim(), cost: Number($('newShopItemCost').value),
      category: $('newShopItemCategory').value, effect: $('newShopItemEffect').value,
      quantity: Number($('newShopItemQuantity').value), active: true
    };
    try {
      await api('/api/admin/shop-items', { method: 'POST', body: JSON.stringify(payload) });
      show('Shop card created.'); $('newShopItemId').value = ''; $('newShopItemTitle').value = ''; $('newShopItemDescription').value = '';
      await loadAdmin(); await loadShop();
    } catch (e) { show(e.message, true); }
  });
  async function loadAdmin() {
    const [tasks, links, claims, withdrawals, shop] = await Promise.all([api('/api/admin/tasks'), api('/api/admin/social-links'), api('/api/admin/task-claims'), api('/api/admin/withdrawals'), api('/api/admin/shop-items')]);
    const taskRoot = $('adminTasks'); taskRoot.replaceChildren();
    tasks.tasks.forEach(t => {
      const card = itemCard(`${t.title} (${t.id})`, `${t.points} SUN · ${t.active ? 'Active' : 'Disabled'}`);
      const actions = el('div', 'actions');
      actions.append(button(t.active ? 'Disable' : 'Enable', async () => { try { await api(`/api/admin/tasks/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: JSON.stringify({ active: !t.active }) }); await loadAdmin(); await loadTasks(); } catch (e) { show(e.message, true); } }));
      actions.append(button('Edit task', async () => {
        const title = prompt('Task title', t.title); if (title === null) return;
        const description = prompt('Task description', t.description || ''); if (description === null) return;
        const url = prompt('HTTPS task URL (leave blank for none)', t.url || ''); if (url === null) return;
        const points = Number(prompt('Reward points', String(t.points))); if (!Number.isSafeInteger(points)) return show('Invalid reward amount.', true);
        try { await api(`/api/admin/tasks/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: JSON.stringify({ title, description, url, points }) }); show('Task updated.'); await loadAdmin(); await loadTasks(); } catch (e) { show(e.message, true); }
      })); card.append(actions); taskRoot.append(card);
    });
    const shopRoot = $('adminShopItems'); shopRoot.replaceChildren();
    if (!shop.items.length) shopRoot.append(el('p', 'empty-state', 'No shop cards configured.'));
    shop.items.forEach(item => {
      const card = itemCard(`${item.title} (${item.id})`, `${Number(item.cost).toLocaleString()} SUN · ${item.category} · effect: ${item.effect} · qty ${item.quantity} · ${item.active ? 'Active' : 'Disabled'}`);
      const actions = el('div', 'actions');
      actions.append(button(item.active ? 'Hide card' : 'Show card', async () => {
        try { await api(`/api/admin/shop-items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) }); show('Shop card visibility updated.'); await loadAdmin(); await loadShop(); }
        catch (e) { show(e.message, true); }
      }));
      actions.append(button('Edit card', async () => {
        const title = prompt('Card title', item.title); if (title === null) return;
        const description = prompt('Description', item.description || ''); if (description === null) return;
        const cost = Number(prompt('Price in SUN (integer)', String(item.cost))); if (!Number.isSafeInteger(cost) || cost < 0) return show('Invalid price.', true);
        const quantity = Number(prompt('Quantity granted (1–1000)', String(item.quantity))); if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) return show('Invalid quantity.', true);
        const category = prompt('Category: item or upgrade', item.category); if (category === null) return;
        const effect = prompt('Effect: seed, spin_ticket, energy_refill, tap_power, inventory', item.effect); if (effect === null) return;
        try { await api(`/api/admin/shop-items/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify({ title, description, cost, quantity, category, effect }) }); show('Shop card updated.'); await loadAdmin(); await loadShop(); }
        catch (e) { show(e.message, true); }
      }));
      actions.append(button('Remove', async () => {
        if (!confirm(`Hide and remove ${item.title} from the active shop? Purchase history and inventory will be retained.`)) return;
        try { await api(`/api/admin/shop-items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); show('Card disabled; old records retained.'); await loadAdmin(); await loadShop(); }
        catch (e) { show(e.message, true); }
      }));
      card.append(actions); shopRoot.append(card);
    });
    const linkRoot = $('adminLinks'); linkRoot.replaceChildren();
    links.links.forEach(l => {
      const card = itemCard(`${l.title} (${l.id})`, `${l.url} · ${l.active ? 'Active' : 'Disabled'}`); const actions = el('div', 'actions');
      actions.append(button(l.active ? 'Disable' : 'Enable', async () => { try { await api(`/api/admin/social-links/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: JSON.stringify({ active: !l.active }) }); await loadAdmin(); await loadSocialLinks(); } catch (e) { show(e.message, true); } }));
      actions.append(button('Edit link', async () => { const title = prompt('Link title', l.title); if (title === null) return; const url = prompt('HTTPS URL', l.url); if (url === null) return; try { await api(`/api/admin/social-links/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: JSON.stringify({ title, url }) }); show('Social link updated.'); await loadAdmin(); await loadSocialLinks(); } catch (e) { show(e.message, true); } }));
      actions.append(button('Delete', async () => { if (!confirm(`Delete ${l.title}?`)) return; try { await api(`/api/admin/social-links/${encodeURIComponent(l.id)}`, { method: 'DELETE' }); await loadAdmin(); await loadSocialLinks(); } catch (e) { show(e.message, true); } })); card.append(actions); linkRoot.append(card);
    });
    const claimRoot = $('adminClaims'); claimRoot.replaceChildren();
    if (!claims.claims.length) claimRoot.append(el('p', 'empty-state', 'No task claims yet.'));
    claims.claims.forEach(c => {
      const card = itemCard(`${c.title || c.task_id} · User ${c.telegram_id}`, `${c.status} · Reward ${c.points ?? 'unknown'} SUN`);
      if (c.status === 'pending') { const actions = el('div', 'actions'); actions.append(button('Approve', async () => { try { await api(`/api/admin/task-claims/${c.id}`, { method: 'POST', body: JSON.stringify({ status: 'approved' }) }); show('Claim approved.'); await loadAdmin(); } catch (e) { show(e.message, true); } }, 'button button-primary')); actions.append(button('Reject', async () => { try { await api(`/api/admin/task-claims/${c.id}`, { method: 'POST', body: JSON.stringify({ status: 'rejected' }) }); show('Claim rejected.'); await loadAdmin(); } catch (e) { show(e.message, true); } })); card.append(actions); } claimRoot.append(card);
    });
    const wRoot = $('adminWithdrawals'); wRoot.replaceChildren();
    if (!withdrawals.length) wRoot.append(el('p', 'empty-state', 'No withdrawal requests yet.'));
    withdrawals.forEach(w => {
      const card = itemCard(`Request #${w.id} · User ${w.telegram_id}`, `${w.points} points · ${w.method} · ${w.status}`);
      if (w.status === 'pending') { const actions = el('div', 'actions'); actions.append(button('Mark approved', async () => { try { await api(`/api/admin/withdrawals/${w.id}`, { method: 'POST', body: JSON.stringify({ status: 'approved' }) }); show('Marked approved; no payment was sent.'); await loadAdmin(); } catch (e) { show(e.message, true); } })); actions.append(button('Reject + refund', async () => { try { await api(`/api/admin/withdrawals/${w.id}`, { method: 'POST', body: JSON.stringify({ status: 'rejected' }) }); show('Rejected and points refunded.'); await loadAdmin(); await loadMe(); } catch (e) { show(e.message, true); } })); card.append(actions); } wRoot.append(card);
    });
  }
  loadMe(); initTonConnect();
})();
