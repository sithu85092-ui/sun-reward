"use strict";

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || "";
const TON_CONNECT_MANIFEST_URL = process.env.TON_CONNECT_MANIFEST_URL || "";
const REFERRAL_POINTS = Math.max(0, Number(process.env.POINTS_PER_REFERRAL || 50));
const DAILY_POINTS = Math.max(0, Number(process.env.DAILY_CHECKIN_POINTS || 5));
const MIN_WITHDRAWAL = Math.max(1, Number(process.env.MIN_WITHDRAWAL_POINTS || 1000));
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
 telegram_id TEXT PRIMARY KEY, first_name TEXT NOT NULL DEFAULT '',
 points INTEGER NOT NULL DEFAULT 0, referred_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
 delta INTEGER NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_claims (
 telegram_id TEXT NOT NULL, task_id TEXT NOT NULL, claimed_at TEXT NOT NULL,
 PRIMARY KEY(telegram_id, task_id)
);
CREATE TABLE IF NOT EXISTS checkins (
 telegram_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(telegram_id, day)
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
 points INTEGER NOT NULL, method TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_rewards (
 referred_id TEXT PRIMARY KEY, referrer_id TEXT NOT NULL,
 points INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_purchases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
 item_id TEXT NOT NULL, cost INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shop_items (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 cost INTEGER NOT NULL CHECK(cost >= 0), category TEXT NOT NULL DEFAULT 'item',
 effect TEXT NOT NULL DEFAULT 'inventory', quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity >= 1),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_items (
 telegram_id TEXT NOT NULL, item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
 updated_at TEXT NOT NULL, PRIMARY KEY(telegram_id,item_id)
);
CREATE TABLE IF NOT EXISTS managed_tasks (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 url TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 0,
 verification TEXT NOT NULL DEFAULT 'manual', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS managed_task_claims (
 id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
 task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 claimed_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT,
 UNIQUE(telegram_id, task_id)
);
CREATE TABLE IF NOT EXISTS social_links (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(telegram_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referred_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_managed_claims_user ON managed_task_claims(telegram_id);
CREATE INDEX IF NOT EXISTS idx_managed_claims_status ON managed_task_claims(status);
`);

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
addColumnIfMissing("users", "wallet_address", "TEXT");
addColumnIfMissing("users", "wallet_chain", "TEXT");
addColumnIfMissing("shop_purchases", "request_id", "TEXT");
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_purchase_request ON shop_purchases(telegram_id,request_id) WHERE request_id IS NOT NULL"); } catch (e) { console.error("Could not create purchase idempotency index:", e.message); }

const now = () => new Date().toISOString();
const utcDay = () => new Date().toISOString().slice(0, 10);
const validId = (v) => typeof v === "string" && /^\d{1,20}$/.test(v);
const validTaskId = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
function validateHttpsUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; }
  catch { return false; }
}
function isVip(user) {
  return Boolean(user && user.vip_until && Number.isFinite(Date.parse(user.vip_until)) && Date.parse(user.vip_until) > Date.now());
}
function addLedger(id, delta, description) {
  db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)")
    .run(id, delta, description, now());
}
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) throw new Error("Server is missing BOT_TOKEN.");
  if (!initData || typeof initData !== "string") throw new Error("Open this app from Telegram.");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Telegram initData hash is invalid.");
  params.delete("hash");
  const authDate = Number(params.get("auth_date") || 0);
  const seconds = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || authDate > seconds + 60 || seconds - authDate > 3600) {
    throw new Error("Telegram session expired. Reopen the app.");
  }
  const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(calculated, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error("Telegram signature verification failed.");
  let user;
  try { user = JSON.parse(params.get("user") || "null"); } catch { throw new Error("Telegram user data is invalid."); }
  if (!user || !user.id || !validId(String(user.id))) throw new Error("Telegram user ID is missing.");
  return { user, startParam: params.get("start_param") || "" };
}
function auth(req,res,next) {
  try { req.telegram = verifyTelegramInitData(req.get("X-Telegram-Init-Data")); next(); }
  catch (e) { res.status(401).json({error:e.message}); }
}
function isAdmin(req,res,next) {
  const provided = req.get("X-Admin-Key") || "";
  if (!ADMIN_KEY || Buffer.byteLength(provided) !== Buffer.byteLength(ADMIN_KEY) ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_KEY))) {
    return res.status(403).json({error:"Forbidden"});
  }
  next();
}
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
const claimLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false });
app.use("/api", apiLimiter);

function getOrCreateUser(tg, startParam = "") {
  const id = String(tg.id);
  const firstName = String(tg.first_name || "Friend").slice(0,100);
  const username = String(tg.username || "").slice(0,100);
  const photoUrl = String(tg.photo_url || "").slice(0,1000);
  const existing = db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
  if (existing) {
    db.prepare("UPDATE users SET first_name=?,username=?,photo_url=? WHERE telegram_id=?")
      .run(firstName,username,photoUrl,id);
    return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
  }
  let referrer = null;
  const match = /^ref_(\d{1,20})$/.exec(startParam);
  if (match && match[1] !== id && db.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").get(match[1])) referrer = match[1];
  db.prepare(`INSERT INTO users(telegram_id,first_name,username,photo_url,referred_by,created_at,energy_updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(id,firstName,username,photoUrl,referrer,now(),now());
  return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
}
async function telegramBotApi(method,payload={}) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload),
    signal:AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(()=>null);
  if (!response.ok || !data?.ok) throw new Error(data?.description || "Telegram API request failed.");
  return data.result;
}
async function checkChannelMembership(id) {
  if (!REQUIRED_CHANNEL) return {configured:false,member:false,error:"REQUIRED_CHANNEL is not configured."};
  try {
    const result = await telegramBotApi("getChatMember",{chat_id:REQUIRED_CHANNEL,user_id:Number(id)});
    const member = ["creator","administrator","member"].includes(result.status) ||
      (result.status === "restricted" && result.is_member === true);
    return {configured:true,member};
  } catch {
    return {configured:true,member:false,error:"Channel membership could not be verified."};
  }
}
function rewardEligibleReferral(referredId) {
  const referred = db.prepare("SELECT telegram_id,referred_by,channel_verified FROM users WHERE telegram_id=?").get(referredId);
  if (!referred || !referred.referred_by || referred.channel_verified !== 1) return false;
  return db.transaction(() => {
    if (!db.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").get(referred.referred_by)) return false;
    const inserted = db.prepare(`INSERT OR IGNORE INTO referral_rewards(referred_id,referrer_id,points,created_at) VALUES(?,?,?,?)`)
      .run(referred.telegram_id,referred.referred_by,REFERRAL_POINTS,now());
    if (!inserted.changes) return false;
    if (REFERRAL_POINTS > 0) {
      db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(REFERRAL_POINTS,referred.referred_by);
      addLedger(referred.referred_by,REFERRAL_POINTS,"Eligible referral bonus");
    }
    return true;
  })();
}
async function syncChannelMembership(id) {
  const status = await checkChannelMembership(id);
  if (status.configured) {
    db.prepare("UPDATE users SET channel_verified=? WHERE telegram_id=?").run(status.member?1:0,id);
    if (status.member) rewardEligibleReferral(id);
  }
  return status;
}
function getReferralCount(id) {
  return db.prepare(`SELECT COUNT(*) AS count FROM users u INNER JOIN referral_rewards r
    ON r.referred_id=u.telegram_id WHERE u.referred_by=?`).get(id).count;
}
function isPlantUnlocked(user) {
  return Boolean(user && user.channel_verified===1 && getReferralCount(user.telegram_id)>=MIN_PLANT_REFERRALS);
}
function updateEnergy(user) {
  const current = Math.max(0,Math.min(MAX_ENERGY,Number(user.energy)||0));
  const previous = Date.parse(user.energy_updated_at || "");
  const elapsed = Number.isFinite(previous)?Math.max(0,(Date.now()-previous)/60000):0;
  const recovered = Math.floor(elapsed*ENERGY_REGEN_PER_MINUTE);
  const energy = Math.min(MAX_ENERGY,current+recovered);
  let updatedAt = user.energy_updated_at || now();
  if (energy>=MAX_ENERGY) updatedAt=now();
  else if (recovered>0) updatedAt=new Date(previous+recovered*60000).toISOString();
  db.prepare("UPDATE users SET energy=?,energy_updated_at=? WHERE telegram_id=?").run(energy,updatedAt,user.telegram_id);
  return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(user.telegram_id);
}
function requirePlantAccess(req,res) {
  const user=db.prepare("SELECT * FROM users WHERE telegram_id=?").get(String(req.telegram.user.id));
  if (!user || !isPlantUnlocked(user)) {
    res.status(403).json({error:"Plant requires 3 eligible referrals and verified channel membership."}); return null;
  }
  return user;
}
// Shop catalog is database-backed so admins can safely add/edit/disable cards.
// Existing default IDs and costs are retained for compatibility with current users.
const defaultShopItems = [
  {id:"seed",title:"Plant Seed",description:"A seed for your garden. Plant it after unlocking garden access.",cost:SEED_COST,category:"item",effect:"seed",quantity:1},
  {id:"spin_ticket",title:"Spin Ticket",description:"Try your luck for extra SUN points.",cost:SPIN_TICKET_COST,category:"item",effect:"spin_ticket",quantity:1},
  {id:"energy_refill",title:"Energy Refill",description:"Restore your energy to the maximum instantly.",cost:150,category:"item",effect:"energy_refill",quantity:1},
  {id:"tap_upgrade",title:"Tap Power +1",description:"Permanently earn one more SUN per tap.",cost:UPGRADE_COST,category:"upgrade",effect:"tap_power",quantity:1},
  {id:"tap_upgrade_5",title:"Tap Power +5",description:"A bigger permanent boost for active players.",cost:1000,category:"upgrade",effect:"tap_power",quantity:5}
];
for (const item of defaultShopItems) {
  db.prepare(`INSERT OR IGNORE INTO shop_items(id,title,description,cost,category,effect,quantity,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,?,?)`).run(item.id,item.title,item.description,item.cost,item.category,item.effect,item.quantity,now(),now());
}
function getShopItems(activeOnly = true) {
  return db.prepare(`SELECT id,title,description,cost,category,effect,quantity,active FROM shop_items ${activeOnly ? "WHERE active=1" : ""} ORDER BY category DESC,title COLLATE NOCASE`).all();
}
function addInventory(telegramId, itemId, quantity = 1) {
  db.prepare(`INSERT INTO inventory_items(telegram_id,item_id,quantity,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(telegram_id,item_id) DO UPDATE SET quantity=inventory_items.quantity+excluded.quantity,updated_at=excluded.updated_at`)
    .run(telegramId,itemId,quantity,now());
}
function removeInventory(telegramId, itemId, quantity = 1) {
  const row = db.prepare("SELECT quantity FROM inventory_items WHERE telegram_id=? AND item_id=?").get(telegramId,itemId);
  if (!row || row.quantity < quantity) throw new Error("Not enough items in inventory.");
  db.prepare("UPDATE inventory_items SET quantity=quantity-?,updated_at=? WHERE telegram_id=? AND item_id=?").run(quantity,now(),telegramId,itemId);
}

// Serve frontend after API routes have been registered.
app.get("/health",(req,res)=>res.json({ok:true,app:"SUN REWARD"}));
// TON Connect manifest must use the real public HTTPS domain. When an explicit
// URL is not configured, derive it from the deployment request host so the
// example placeholder domain can never silently break wallet connection.
function publicOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}`;
}
app.get("/tonconnect-manifest.json",(req,res)=>{
  const origin = publicOrigin(req);
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    url: origin,
    name: "SUN REWARD",
    iconUrl: `${origin}/icon.svg`,
    termsOfUseUrl: `${origin}/terms`,
    privacyPolicyUrl: `${origin}/privacy`
  });
});
app.get("/api/public-config",(req,res)=>{
  const origin = publicOrigin(req);
  const configured = TON_CONNECT_MANIFEST_URL.trim();
  const isPlaceholder = !configured || /your-domain\.example/i.test(configured);
  const manifestUrl = isPlaceholder ? `${origin}/tonconnect-manifest.json` : configured;
  res.json({tonConnectManifestUrl:manifestUrl});
});
app.get("/api/wallet",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  res.json({wallet:{address:user.wallet_address||null,chain:user.wallet_chain||null}});
});
app.post("/api/wallet/connect",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const address=String(req.body?.address||"").trim();
  const chain=String(req.body?.chain||"").slice(0,32);
  const raw=/^-?\d+:[a-fA-F0-9]{64}$/.test(address);
  const friendly=/^[A-Za-z0-9_-]{48}$/.test(address);
  if(address.length>128||(!raw&&!friendly))return res.status(400).json({error:"Invalid TON wallet address received from TON Connect."});
  db.prepare("UPDATE users SET wallet_address=?,wallet_chain=? WHERE telegram_id=?").run(address,chain,user.telegram_id);
  res.json({ok:true,wallet:{address,chain},message:"TON wallet linked to your profile."});
});
app.post("/api/wallet/disconnect",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  db.prepare("UPDATE users SET wallet_address=NULL,wallet_chain=NULL WHERE telegram_id=?").run(user.telegram_id);
  res.json({ok:true,message:"Wallet disconnected from your profile."});
});
app.get("/api/me",auth,async(req,res)=>{
  try {
    let user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
    const channel=await syncChannelMembership(user.telegram_id);
    user=updateEnergy(db.prepare("SELECT * FROM users WHERE telegram_id=?").get(user.telegram_id));
    const ledger=db.prepare("SELECT delta,description,created_at FROM ledger WHERE telegram_id=? ORDER BY id DESC LIMIT 20").all(user.telegram_id);
    const referralLink=BOT_USERNAME?`https://t.me/${BOT_USERNAME}?startapp=ref_${user.telegram_id}`:"";
    const referralCount=getReferralCount(user.telegram_id);
    res.json({
      user:{id:user.telegram_id,first_name:user.first_name,username:user.username,photo_url:user.photo_url,
        points:user.points,created_at:user.created_at,vip:isVip(user),vipExpiry:user.vip_until,
        energy:user.energy,energyMax:MAX_ENERGY,tapPower:user.tap_power,seeds:user.seeds,spinTickets:user.spin_tickets,
        plant:{unlocked:isPlantUnlocked(user),stage:user.plant_stage,growth:user.plant_growth},referral_count:referralCount},
      tasks:[],ledger,referralLink,referralCount,channel:{configured:channel.configured,member:channel.member},
      plantUnlocked:isPlantUnlocked(user),
      config:{referralPoints:REFERRAL_POINTS,minWithdrawalPoints:MIN_WITHDRAWAL,minPlantReferrals:MIN_PLANT_REFERRALS,requiredChannel:REQUIRED_CHANNEL}
    });
  } catch(e) { console.error("GET /api/me failed:",e.message); res.status(500).json({error:"Could not load account."}); }
});

app.post("/api/checkin",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const tx=db.transaction(()=>{
    const inserted=db.prepare("INSERT OR IGNORE INTO checkins(telegram_id,day) VALUES(?,?)").run(user.telegram_id,utcDay());
    if(!inserted.changes) return false;
    db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(DAILY_POINTS,user.telegram_id);
    addLedger(user.telegram_id,DAILY_POINTS,"Daily check-in"); return true;
  });
  if(!tx()) return res.status(409).json({error:"Daily check-in already claimed today."});
  res.json({ok:true,points:DAILY_POINTS,message:`Daily check-in: +${DAILY_POINTS} SUN`});
});

app.post("/api/tap",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  updateEnergy(user);
  const earned=db.transaction(()=>{
    const fresh=db.prepare("SELECT energy,tap_power FROM users WHERE telegram_id=?").get(user.telegram_id);
    if(!fresh || fresh.energy<1) throw new Error("No energy left. Wait for energy to regenerate.");
    const points=Math.max(1,Math.min(100,Number(fresh.tap_power)||1));
    db.prepare("UPDATE users SET energy=energy-1,points=points+? WHERE telegram_id=?").run(points,user.telegram_id);
    addLedger(user.telegram_id,points,"Tap to Earn"); return points;
  });
  try { const points=earned(); res.json({ok:true,earned:points,message:`+${points} SUN`}); }
  catch(e) { res.status(429).json({error:e.message}); }
});

app.post("/api/plant/verify",auth,async(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const channel=await syncChannelMembership(user.telegram_id);
  const fresh=db.prepare("SELECT * FROM users WHERE telegram_id=?").get(user.telegram_id);
  const unlocked=isPlantUnlocked(fresh);
  res.json({ok:true,plantUnlocked:unlocked,plant:{unlocked,stage:fresh.plant_stage,growth:fresh.plant_growth},
    message:unlocked?"Garden unlocked.":`Plant requires ${MIN_PLANT_REFERRALS} eligible referrals and channel membership.`,channel});
});
app.post("/api/plant/buy-seed",auth,(req,res)=>{
  const user=requirePlantAccess(req,res); if(!user)return;
  try {
    db.transaction(()=>{
      const item=db.prepare("SELECT * FROM shop_items WHERE id='seed' AND active=1 AND effect='seed'").get();
      if(!item)throw new Error("Plant seeds are not available in the shop right now.");
      const debit=db.prepare("UPDATE users SET points=points-?,seeds=seeds+? WHERE telegram_id=? AND points>=?")
        .run(item.cost,item.quantity,user.telegram_id,item.cost);
      if(!debit.changes)throw new Error(`You need ${item.cost} SUN to buy a seed.`);
      addInventory(user.telegram_id,"seed",item.quantity);
      addLedger(user.telegram_id,-item.cost,`Bought plant seed: ${item.title}`);
      db.prepare("INSERT INTO shop_purchases(telegram_id,item_id,cost,created_at) VALUES(?,?,?,?)").run(user.telegram_id,item.id,item.cost,now());
    })(); res.json({ok:true,message:"Seed purchased."});
  } catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/plant/plant",auth,(req,res)=>{
  const user=requirePlantAccess(req,res); if(!user)return;
  const result=db.transaction(()=>{
    const fresh=db.prepare("SELECT seeds,plant_stage FROM users WHERE telegram_id=?").get(user.telegram_id);
    if(fresh.plant_stage>0)throw new Error("You already have a plant growing.");
    if(fresh.seeds<1)throw new Error("Buy a seed before planting.");
    const inv=db.prepare("SELECT quantity FROM inventory_items WHERE telegram_id=? AND item_id='seed'").get(user.telegram_id);
    if(inv && inv.quantity>0) removeInventory(user.telegram_id,"seed",1);
    db.prepare("UPDATE users SET seeds=seeds-1,plant_stage=1,plant_growth=0,plant_planted_at=? WHERE telegram_id=?").run(now(),user.telegram_id);
  });
  try{result();res.json({ok:true,message:"Seed planted."});}catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/plant/water",auth,(req,res)=>{
  const user=requirePlantAccess(req,res); if(!user)return;
  try {
    db.transaction(()=>{
      const fresh=db.prepare("SELECT points,plant_stage,plant_growth FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(fresh.plant_stage<1)throw new Error("Plant a seed first.");
      if(fresh.plant_growth>=100)throw new Error("Your plant is ready to harvest.");
      if(fresh.points<WATER_COST)throw new Error(`You need ${WATER_COST} SUN to water your plant.`);
      db.prepare("UPDATE users SET points=points-?,plant_growth=? WHERE telegram_id=?").run(WATER_COST,Math.min(100,fresh.plant_growth+25),user.telegram_id);
      addLedger(user.telegram_id,-WATER_COST,"Watered plant");
    })();res.json({ok:true,message:"Plant watered. Growth increased."});
  }catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/plant/harvest",auth,(req,res)=>{
  const user=requirePlantAccess(req,res); if(!user)return;
  const reward=150;
  try {
    db.transaction(()=>{
      const fresh=db.prepare("SELECT plant_stage,plant_growth FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(fresh.plant_stage<1||fresh.plant_growth<100)throw new Error("Your plant is not ready to harvest.");
      db.prepare("UPDATE users SET points=points+?,plant_stage=0,plant_growth=0,plant_planted_at=NULL WHERE telegram_id=?").run(reward,user.telegram_id);
      addLedger(user.telegram_id,reward,"Plant harvest");
    })();res.json({ok:true,reward,message:`Harvest complete: +${reward} SUN`});
  }catch(e){res.status(400).json({error:e.message});}
});

app.get("/api/shop",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const inventory=db.prepare(`SELECT i.item_id AS itemId,i.quantity,s.title,s.category,s.effect
    FROM inventory_items i LEFT JOIN shop_items s ON s.id=i.item_id WHERE i.telegram_id=? AND i.quantity>0 ORDER BY s.category DESC,s.title COLLATE NOCASE`).all(user.telegram_id);
  res.json({items:getShopItems(true).map(({effect,...item})=>item),inventory:{seeds:user.seeds,spinTickets:user.spin_tickets,tapPower:user.tap_power,items:inventory}});
});
app.get("/api/inventory",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const items=db.prepare(`SELECT i.item_id AS itemId,i.quantity,s.title,s.description,s.category,s.effect
    FROM inventory_items i LEFT JOIN shop_items s ON s.id=i.item_id WHERE i.telegram_id=? AND i.quantity>0 ORDER BY s.category DESC,s.title COLLATE NOCASE`).all(user.telegram_id);
  res.json({items,legacy:{seeds:user.seeds,spinTickets:user.spin_tickets,tapPower:user.tap_power}});
});
app.post("/api/shop/buy",auth,claimLimiter,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const itemId=String(req.body?.itemId||"");
  const requestId=String(req.body?.requestId||"").trim();
  if(requestId && !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({error:"Invalid purchase request ID."});
  try {
    const result=db.transaction(()=>{
      if(requestId){
        const previous=db.prepare("SELECT id,item_id,cost,created_at FROM shop_purchases WHERE telegram_id=? AND request_id=?").get(user.telegram_id,requestId);
        if(previous)return {duplicate:true,purchase:previous};
      }
      const item=db.prepare("SELECT * FROM shop_items WHERE id=? AND active=1").get(itemId);
      if(!item)throw new Error("This shop item is unavailable.");
      if(!Number.isSafeInteger(item.cost)||item.cost<0)throw new Error("Invalid shop item price.");
      const fresh=db.prepare("SELECT points,energy,tap_power FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(!fresh || fresh.points<item.cost)throw new Error("Not enough SUN points.");
      // Deduct points conditionally inside the same SQLite transaction to prevent race-based overspending.
      const debit=db.prepare("UPDATE users SET points=points-? WHERE telegram_id=? AND points>=?").run(item.cost,user.telegram_id,item.cost);
      if(!debit.changes)throw new Error("Not enough SUN points.");
      switch(item.effect){
        case "seed":
          db.prepare("UPDATE users SET seeds=seeds+? WHERE telegram_id=?").run(item.quantity,user.telegram_id);
          addInventory(user.telegram_id,item.id,item.quantity); break;
        case "spin_ticket":
          db.prepare("UPDATE users SET spin_tickets=spin_tickets+? WHERE telegram_id=?").run(item.quantity,user.telegram_id);
          addInventory(user.telegram_id,item.id,item.quantity); break;
        case "energy_refill":
          db.prepare("UPDATE users SET energy=?,energy_updated_at=? WHERE telegram_id=?").run(MAX_ENERGY,now(),user.telegram_id); break;
        case "tap_power":
          db.prepare("UPDATE users SET tap_power=MIN(100,tap_power+?) WHERE telegram_id=?").run(item.quantity,user.telegram_id);
          addInventory(user.telegram_id,item.id,item.quantity); break;
        case "inventory":
          addInventory(user.telegram_id,item.id,item.quantity); break;
        default: throw new Error("This item has an unsupported effect. Ask admin to edit it.");
      }
      addLedger(user.telegram_id,-item.cost,`Shop purchase: ${item.title}`);
      const purchase=db.prepare("INSERT INTO shop_purchases(telegram_id,item_id,cost,created_at,request_id) VALUES(?,?,?,?,?)")
        .run(user.telegram_id,item.id,item.cost,now(),requestId||null);
      return {duplicate:false,purchase:{id:Number(purchase.lastInsertRowid),item_id:item.id,cost:item.cost},item};
    })();
    if(result.duplicate)return res.json({ok:true,duplicate:true,message:"This purchase was already processed.",purchase:result.purchase});
    const fresh=db.prepare("SELECT points,seeds,spin_tickets,tap_power,energy FROM users WHERE telegram_id=?").get(user.telegram_id);
    res.json({ok:true,message:`${result.item.title} purchased successfully.`,purchase:result.purchase,balance:fresh.points,inventory:{seeds:fresh.seeds,spinTickets:fresh.spin_tickets,tapPower:fresh.tap_power,energy:fresh.energy}});
  }catch(e){
    if(String(e.code||"").startsWith("SQLITE_CONSTRAINT"))return res.status(409).json({error:"This purchase request has already been processed."});
    res.status(400).json({error:e.message});
  }
});

app.post("/api/spin",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const rewards=[{points:0,weight:20},{points:5,weight:35},{points:10,weight:25},{points:25,weight:15},{points:50,weight:5}];
  const total=rewards.reduce((s,r)=>s+r.weight,0);
  try {
    const points=db.transaction(()=>{
      const fresh=db.prepare("SELECT spin_tickets FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(!fresh||fresh.spin_tickets<1)throw new Error("You need a spin ticket.");
      db.prepare("UPDATE users SET spin_tickets=spin_tickets-1 WHERE telegram_id=?").run(user.telegram_id);
      const inv=db.prepare("SELECT quantity FROM inventory_items WHERE telegram_id=? AND item_id='spin_ticket'").get(user.telegram_id);
      if(inv && inv.quantity>0) removeInventory(user.telegram_id,"spin_ticket",1);
      let roll=crypto.randomInt(total),reward=rewards[0];
      for(const r of rewards){if(roll<r.weight){reward=r;break;}roll-=r.weight;}
      if(reward.points>0){db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(reward.points,user.telegram_id);addLedger(user.telegram_id,reward.points,"Spin reward");}
      return reward.points;
    })();
    res.json({ok:true,points,message:points?`You won ${points} SUN points.`:"No points this time. Try again with another ticket."});
  }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/vip",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  res.json({vip:isVip(user),vipExpiry:user.vip_until||null,message:isVip(user)?"Active VIP membership.":"No active VIP membership."});
});
app.post("/api/withdrawals",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  if(!isVip(user))return res.status(403).json({error:"An active VIP membership is required to request withdrawal."});
  const points=Number(req.body?.points),method=String(req.body?.method||"manual_review");
  const methods=["manual_review","TON","USDT","KBZPay","WavePay"];
  if(!Number.isSafeInteger(points)||points<MIN_WITHDRAWAL)return res.status(400).json({error:`Minimum request is ${MIN_WITHDRAWAL} points.`});
  if(!methods.includes(method))return res.status(400).json({error:"Unsupported method."});
  try {
    const id=db.transaction(()=>{
      const fresh=db.prepare("SELECT points,vip_until FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(!isVip(fresh))throw new Error("An active VIP membership is required.");
      if(fresh.points<points)throw new Error("Not enough points.");
      db.prepare("UPDATE users SET points=points-? WHERE telegram_id=?").run(points,user.telegram_id);
      const result=db.prepare("INSERT INTO withdrawals(telegram_id,points,method,status,created_at) VALUES(?,?,?,'pending',?)").run(user.telegram_id,points,method,now());
      addLedger(user.telegram_id,-points,`Withdrawal request #${result.lastInsertRowid}`);
      return result.lastInsertRowid;
    })();res.json({ok:true,id,message:"Request submitted for manual review. Payout is not guaranteed."});
  }catch(e){res.status(400).json({error:e.message});}
});

// -------------------- Dynamic Tasks --------------------
app.get("/api/tasks",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const tasks=db.prepare(`SELECT t.id,t.title,t.description,t.url,t.points,
    COALESCE(c.status,'') AS claim_status,
    CASE WHEN c.status='approved' THEN 1 ELSE 0 END AS completed
    FROM managed_tasks t LEFT JOIN managed_task_claims c
    ON c.task_id=t.id AND c.telegram_id=? WHERE t.active=1 ORDER BY t.created_at DESC`).all(user.telegram_id);
  res.json({tasks});
});
app.post("/api/tasks/:id/claim",auth,claimLimiter,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const id=req.params.id;
  if(!validTaskId(id))return res.status(400).json({error:"Invalid task ID."});
  const task=db.prepare("SELECT id FROM managed_tasks WHERE id=? AND active=1").get(id);
  if(!task)return res.status(404).json({error:"Task not found."});
  try {
    const previous=db.prepare("SELECT id,status FROM managed_task_claims WHERE telegram_id=? AND task_id=?").get(user.telegram_id,id);
    if(previous && previous.status!=="rejected") return res.status(409).json({error:"Task already submitted.",status:previous.status});
    if(previous) db.prepare("UPDATE managed_task_claims SET status='pending',claimed_at=?,reviewed_at=NULL,reviewed_by=NULL WHERE id=?").run(now(),previous.id);
    else db.prepare("INSERT INTO managed_task_claims(telegram_id,task_id,status,claimed_at) VALUES(?,?,'pending',?)").run(user.telegram_id,id,now());
    res.status(201).json({ok:true,status:"pending",message:"Task submitted for admin review."});
  }catch(e){
    if(String(e.code||"").startsWith("SQLITE_CONSTRAINT")){
      const claim=db.prepare("SELECT status FROM managed_task_claims WHERE telegram_id=? AND task_id=?").get(user.telegram_id,id);
      return res.status(409).json({error:"Task already submitted.",status:claim?.status||"pending"});
    }
    console.error("Task claim failed:",e.message);res.status(500).json({error:"Could not submit task."});
  }
});
app.get("/api/social-links",(req,res)=>{
  res.json({links:db.prepare("SELECT id,title,url FROM social_links WHERE active=1 ORDER BY title COLLATE NOCASE").all()});
});

// -------------------- Admin APIs --------------------
const validShopEffect = new Set(["seed","spin_ticket","energy_refill","tap_power","inventory"]);
function validateShopItemBody(body, old = null) {
  const b=body||{};
  const id=old?old.id:String(b.id||"").trim();
  const title=b.title===undefined?(old?.title||""):String(b.title).trim();
  const description=b.description===undefined?(old?.description||""):String(b.description).trim();
  const cost=b.cost===undefined ? (old ? old.cost : Number(b.cost)) : Number(b.cost);
  const category=b.category===undefined?(old?.category||"item"):String(b.category);
  const effect=b.effect===undefined?(old?.effect||"inventory"):String(b.effect);
  const quantity=b.quantity===undefined?(old?.quantity||1):Number(b.quantity);
  const active=b.active===undefined?(old?.active??1):b.active;
  if(!validTaskId(id))throw new Error("Card ID must use 1-64 letters, numbers, underscores or hyphens.");
  if(!title||title.length>100||description.length>500)throw new Error("Invalid card title or description.");
  if(!Number.isSafeInteger(cost)||cost<0||cost>1000000000)throw new Error("Price must be an integer from 0 to 1,000,000,000 SUN.");
  if(!["item","upgrade"].includes(category))throw new Error("Category must be item or upgrade.");
  if(!validShopEffect.has(effect))throw new Error("Unsupported item effect.");
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)throw new Error("Quantity must be from 1 to 1000.");
  if(![0,1,true,false].includes(active))throw new Error("active must be true or false.");
  if(["seed","spin_ticket","energy_refill"].includes(effect)&&category!=="item")throw new Error("Seed, spin ticket and energy refill effects must use the item category.");
  if(effect==="tap_power"&&category!=="upgrade")throw new Error("Tap power must be an upgrade.");
  return {id,title,description,cost,category,effect,quantity,active:Number(Boolean(active))};
}
app.get("/api/admin/shop-items",isAdmin,(req,res)=>res.json({items:getShopItems(false)}));
app.post("/api/admin/shop-items",isAdmin,(req,res)=>{
  let item;try{item=validateShopItemBody(req.body);}catch(e){return res.status(400).json({error:e.message});}
  try{
    db.prepare(`INSERT INTO shop_items(id,title,description,cost,category,effect,quantity,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(item.id,item.title,item.description,item.cost,item.category,item.effect,item.quantity,item.active,now(),now());
    res.status(201).json({ok:true,item});
  }catch(e){if(String(e.code||"").startsWith("SQLITE_CONSTRAINT"))return res.status(409).json({error:"Card ID already exists."});res.status(500).json({error:"Could not create shop card."});}
});
app.patch("/api/admin/shop-items/:id",isAdmin,(req,res)=>{
  const id=req.params.id;if(!validTaskId(id))return res.status(400).json({error:"Invalid card ID."});
  const old=db.prepare("SELECT * FROM shop_items WHERE id=?").get(id);if(!old)return res.status(404).json({error:"Shop card not found."});
  let item;try{item=validateShopItemBody(req.body,old);}catch(e){return res.status(400).json({error:e.message});}
  db.prepare(`UPDATE shop_items SET title=?,description=?,cost=?,category=?,effect=?,quantity=?,active=?,updated_at=? WHERE id=?`)
    .run(item.title,item.description,item.cost,item.category,item.effect,item.quantity,item.active,now(),id);
  res.json({ok:true,item});
});
app.delete("/api/admin/shop-items/:id",isAdmin,(req,res)=>{
  const id=req.params.id;if(!validTaskId(id))return res.status(400).json({error:"Invalid card ID."});
  const result=db.prepare("UPDATE shop_items SET active=0,updated_at=? WHERE id=?").run(now(),id);
  if(!result.changes)return res.status(404).json({error:"Shop card not found."});
  res.json({ok:true,message:"Card disabled; purchase and inventory history retained."});
});
app.get("/api/admin/shop-purchases",isAdmin,(req,res)=>{
  res.json({purchases:db.prepare(`SELECT p.id,p.telegram_id,p.item_id,s.title,p.cost,p.created_at,p.request_id
    FROM shop_purchases p LEFT JOIN shop_items s ON s.id=p.item_id ORDER BY p.id DESC LIMIT 300`).all()});
});
app.get("/api/admin/inventory/:telegramId",isAdmin,(req,res)=>{
  const id=String(req.params.telegramId);if(!validId(id))return res.status(400).json({error:"Invalid Telegram user ID."});
  const user=db.prepare("SELECT telegram_id,seeds,spin_tickets,tap_power,energy FROM users WHERE telegram_id=?").get(id);
  if(!user)return res.status(404).json({error:"User not found."});
  const items=db.prepare(`SELECT i.item_id AS itemId,i.quantity,i.updated_at,s.title,s.category,s.effect
    FROM inventory_items i LEFT JOIN shop_items s ON s.id=i.item_id WHERE i.telegram_id=? ORDER BY i.updated_at DESC`).all(id);
  res.json({user,items});
});
app.get("/api/admin/tasks",isAdmin,(req,res)=>res.json({tasks:db.prepare("SELECT * FROM managed_tasks ORDER BY created_at DESC").all()}));
app.post("/api/admin/tasks",isAdmin,(req,res)=>{
  const id=String(req.body?.id||"").trim(),title=String(req.body?.title||"").trim();
  const description=String(req.body?.description||"").trim(),url=String(req.body?.url||"").trim(),points=Number(req.body?.points);
  if(!validTaskId(id))return res.status(400).json({error:"Invalid task ID."});
  if(!title||title.length>120||description.length>1000)return res.status(400).json({error:"Invalid task title or description."});
  if(url&&!validateHttpsUrl(url))return res.status(400).json({error:"Task URL must be HTTPS."});
  if(!Number.isSafeInteger(points)||points<0||points>1000000)return res.status(400).json({error:"Invalid task reward."});
  try{db.prepare("INSERT INTO managed_tasks(id,title,description,url,points,verification,active,created_at,updated_at) VALUES(?,?,?,?,?,'manual',1,?,?)").run(id,title,description,url,points,now(),now());res.status(201).json({ok:true,id});}
  catch(e){if(String(e.code||"").startsWith("SQLITE_CONSTRAINT"))return res.status(409).json({error:"Task ID already exists."});res.status(500).json({error:"Could not create task."});}
});
app.patch("/api/admin/tasks/:id",isAdmin,(req,res)=>{
  const id=req.params.id;if(!validTaskId(id))return res.status(400).json({error:"Invalid task ID."});
  const old=db.prepare("SELECT * FROM managed_tasks WHERE id=?").get(id);if(!old)return res.status(404).json({error:"Task not found."});
  const b=req.body||{},title=b.title===undefined?old.title:String(b.title).trim(),description=b.description===undefined?old.description:String(b.description).trim(),url=b.url===undefined?old.url:String(b.url).trim(),points=b.points===undefined?old.points:Number(b.points),active=b.active===undefined?old.active:b.active;
  if(!title||title.length>120||description.length>1000)return res.status(400).json({error:"Invalid task text."});
  if(url&&!validateHttpsUrl(url))return res.status(400).json({error:"Invalid HTTPS URL."});
  if(!Number.isSafeInteger(points)||points<0||points>1000000)return res.status(400).json({error:"Invalid reward."});
  if(![0,1,true,false].includes(active))return res.status(400).json({error:"active must be true or false."});
  db.prepare("UPDATE managed_tasks SET title=?,description=?,url=?,points=?,active=?,updated_at=? WHERE id=?").run(title,description,url,points,Number(Boolean(active)),now(),id);
  res.json({ok:true});
});
app.delete("/api/admin/tasks/:id",isAdmin,(req,res)=>{
  const id=req.params.id;if(!validTaskId(id))return res.status(400).json({error:"Invalid task ID."});
  const result=db.prepare("UPDATE managed_tasks SET active=0,updated_at=? WHERE id=?").run(now(),id);
  if(!result.changes)return res.status(404).json({error:"Task not found."});
  res.json({ok:true,message:"Task disabled; claims retained."});
});
app.get("/api/admin/task-claims",isAdmin,(req,res)=>{
  res.json({claims:db.prepare(`SELECT c.id,c.telegram_id,c.task_id,c.status,c.claimed_at,c.reviewed_at,t.title,t.points
    FROM managed_task_claims c LEFT JOIN managed_tasks t ON t.id=c.task_id
    ORDER BY CASE WHEN c.status='pending' THEN 0 ELSE 1 END,c.id DESC LIMIT 500`).all()});
});
app.post("/api/admin/task-claims/:id",isAdmin,(req,res)=>{
  const claimId=Number(req.params.id),status=String(req.body?.status||"");
  if(!Number.isSafeInteger(claimId)||claimId<1)return res.status(400).json({error:"Invalid claim ID."});
  if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Status must be approved or rejected."});
  try {
    db.transaction(()=>{
      const claim=db.prepare("SELECT * FROM managed_task_claims WHERE id=?").get(claimId);
      if(!claim)throw new Error("Claim not found.");
      if(claim.status!=="pending")throw new Error("Claim already reviewed.");
      if(status==="approved"){
        const task=db.prepare("SELECT points FROM managed_tasks WHERE id=?").get(claim.task_id);
        if(!task)throw new Error("Task no longer exists.");
        if(!db.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").get(claim.telegram_id))throw new Error("User not found.");
        db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(task.points,claim.telegram_id);
        if(task.points>0)addLedger(claim.telegram_id,task.points,`Task reward: ${claim.task_id}`);
      }
      db.prepare("UPDATE managed_task_claims SET status=?,reviewed_at=?,reviewed_by='admin' WHERE id=?").run(status,now(),claimId);
    })();res.json({ok:true,status});
  }catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/admin/social-links",isAdmin,(req,res)=>res.json({links:db.prepare("SELECT * FROM social_links ORDER BY title COLLATE NOCASE").all()}));
app.post("/api/admin/social-links",isAdmin,(req,res)=>{
  const id=String(req.body?.id||"").trim(),title=String(req.body?.title||"").trim(),url=String(req.body?.url||"").trim();
  if(!validTaskId(id))return res.status(400).json({error:"Invalid link ID."});
  if(!title||title.length>100)return res.status(400).json({error:"Invalid link title."});
  if(!validateHttpsUrl(url))return res.status(400).json({error:"Link must be HTTPS."});
  try{db.prepare("INSERT INTO social_links(id,title,url,active,updated_at) VALUES(?,?,?,1,?)").run(id,title,url,now());res.status(201).json({ok:true,id});}
  catch(e){if(String(e.code||"").startsWith("SQLITE_CONSTRAINT"))return res.status(409).json({error:"Link ID already exists."});res.status(500).json({error:"Could not create link."});}
});
app.patch("/api/admin/social-links/:id",isAdmin,(req,res)=>{
  const id=req.params.id;if(!validTaskId(id))return res.status(400).json({error:"Invalid link ID."});
  const old=db.prepare("SELECT * FROM social_links WHERE id=?").get(id);if(!old)return res.status(404).json({error:"Link not found."});
  const b=req.body||{},title=b.title===undefined?old.title:String(b.title).trim(),url=b.url===undefined?old.url:String(b.url).trim(),active=b.active===undefined?old.active:b.active;
  if(!title||title.length>100)return res.status(400).json({error:"Invalid title."});
  if(!validateHttpsUrl(url))return res.status(400).json({error:"Invalid HTTPS URL."});
  if(![0,1,true,false].includes(active))return res.status(400).json({error:"active must be true or false."});
  db.prepare("UPDATE social_links SET title=?,url=?,active=?,updated_at=? WHERE id=?").run(title,url,Number(Boolean(active)),now(),id);
  res.json({ok:true});
});
app.delete("/api/admin/social-links/:id",isAdmin,(req,res)=>{
  const id=req.params.id;if(!validTaskId(id))return res.status(400).json({error:"Invalid link ID."});
  const result=db.prepare("DELETE FROM social_links WHERE id=?").run(id);
  if(!result.changes)return res.status(404).json({error:"Link not found."});
  res.json({ok:true});
});
app.get("/api/admin/withdrawals",isAdmin,(req,res)=>{
  res.json(db.prepare("SELECT id,telegram_id,points,method,status,created_at FROM withdrawals ORDER BY id DESC LIMIT 100").all());
});
app.post("/api/admin/withdrawals/:id",isAdmin,(req,res)=>{
  const id=Number(req.params.id),status=String(req.body?.status||"");
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:"Invalid request ID."});
  if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Status must be approved or rejected."});
  try{
    db.transaction(()=>{
      const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(id);
      if(!w)throw new Error("Request not found.");
      if(w.status!=="pending")throw new Error("Request already reviewed.");
      db.prepare("UPDATE withdrawals SET status=? WHERE id=?").run(status,id);
      if(status==="rejected"){db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(w.points,w.telegram_id);addLedger(w.telegram_id,w.points,`Refund for rejected request #${id}`);}
    })();res.json({ok:true,status,note:"Status only; no payment was transferred."});
  }catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/admin/users/:id/vip",isAdmin,(req,res)=>{
  const id=String(req.params.id),days=Number(req.body?.days);
  if(!validId(id))return res.status(400).json({error:"Invalid Telegram user ID."});
  if(!Number.isSafeInteger(days)||days<1||days>365)return res.status(400).json({error:"days must be between 1 and 365."});
  const user=db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
  if(!user)return res.status(404).json({error:"User not found."});
  const base=isVip(user)?Date.parse(user.vip_until):Date.now();
  const until=new Date(base+days*86400000).toISOString();
  db.prepare("UPDATE users SET vip_until=? WHERE telegram_id=?").run(until,id);
  res.json({ok:true,telegram_id:id,vip_until:until,note:"VIP granted by admin; no payment processed."});
});

// Safe static hosting and fallback.
app.use(express.static(__dirname, { index: "index.html" }));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.use((err,req,res,next)=>{
  console.error("Unhandled error:",err.message);
  if(res.headersSent)return next(err);
  res.status(500).json({error:"Internal server error."});
});
app.listen(PORT,()=>console.log(`SUN REWARD listening on port ${PORT}`));
