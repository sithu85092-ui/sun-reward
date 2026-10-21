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
const shopItems = [
  {id:"seed",title:"Plant Seed",cost:SEED_COST},
  {id:"spin_ticket",title:"Spin Ticket",cost:SPIN_TICKET_COST},
  {id:"tap_upgrade",title:"Tap Power Upgrade",cost:UPGRADE_COST}
];

// Serve frontend after API routes have been registered.
app.get("/health",(req,res)=>res.json({ok:true,app:"SUN REWARD"}));
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
      const fresh=db.prepare("SELECT points FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(fresh.points<SEED_COST)throw new Error(`You need ${SEED_COST} SUN to buy a seed.`);
      db.prepare("UPDATE users SET points=points-?,seeds=seeds+1 WHERE telegram_id=?").run(SEED_COST,user.telegram_id);
      addLedger(user.telegram_id,-SEED_COST,"Bought plant seed");
      db.prepare("INSERT INTO shop_purchases(telegram_id,item_id,cost,created_at) VALUES(?,'seed',?,?)").run(user.telegram_id,SEED_COST,now());
    })(); res.json({ok:true,message:"Seed purchased."});
  } catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/plant/plant",auth,(req,res)=>{
  const user=requirePlantAccess(req,res); if(!user)return;
  const result=db.transaction(()=>{
    const fresh=db.prepare("SELECT seeds,plant_stage FROM users WHERE telegram_id=?").get(user.telegram_id);
    if(fresh.plant_stage>0)throw new Error("You already have a plant growing.");
    if(fresh.seeds<1)throw new Error("Buy a seed before planting.");
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
  res.json({items:shopItems,inventory:{seeds:user.seeds,spinTickets:user.spin_tickets,tapPower:user.tap_power}});
});
app.post("/api/shop/buy",auth,(req,res)=>{
  const user=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const item=shopItems.find(x=>x.id===req.body?.itemId);
  if(!item)return res.status(400).json({error:"Unknown shop item."});
  try {
    db.transaction(()=>{
      const fresh=db.prepare("SELECT points FROM users WHERE telegram_id=?").get(user.telegram_id);
      if(fresh.points<item.cost)throw new Error("Not enough SUN points.");
      db.prepare("UPDATE users SET points=points-? WHERE telegram_id=?").run(item.cost,user.telegram_id);
      if(item.id==="seed")db.prepare("UPDATE users SET seeds=seeds+1 WHERE telegram_id=?").run(user.telegram_id);
      if(item.id==="spin_ticket")db.prepare("UPDATE users SET spin_tickets=spin_tickets+1 WHERE telegram_id=?").run(user.telegram_id);
      if(item.id==="tap_upgrade")db.prepare("UPDATE users SET tap_power=tap_power+1 WHERE telegram_id=?").run(user.telegram_id);
      addLedger(user.telegram_id,-item.cost,`Shop purchase: ${item.title}`);
      db.prepare("INSERT INTO shop_purchases(telegram_id,item_id,cost,created_at) VALUES(?,?,?,?)").run(user.telegram_id,item.id,item.cost,now());
    })();res.json({ok:true,message:`${item.title} purchased.`});
  }catch(e){res.status(400).json({error:e.message});}
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
    db.prepare("INSERT INTO managed_task_claims(telegram_id,task_id,status,claimed_at) VALUES(?,?,'pending',?)").run(user.telegram_id,id,now());
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
