require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
app.use(express.json({limit:"32kb"}));
app.use(express.static(__dirname));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const REFERRAL_POINTS = Math.max(0, Number(process.env.POINTS_PER_REFERRAL || 50));
const DAILY_POINTS = Math.max(0, Number(process.env.DAILY_CHECKIN_POINTS || 5));
const MIN_WITHDRAWAL = Math.max(1, Number(process.env.MIN_WITHDRAWAL_POINTS || 1000));
const db = new Database(path.join(__dirname, "data.sqlite"));
db.pragma("journal_mode = WAL");
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
  telegram_id TEXT NOT NULL, day TEXT NOT NULL,
  PRIMARY KEY(telegram_id, day)
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
  points INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const day = () => new Date().toISOString().slice(0,10);
function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) throw new Error("Server is missing BOT_TOKEN.");
  if (!initData || typeof initData !== "string") throw new Error("Open this app from Telegram.");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Telegram initData hash is missing.");
  params.delete("hash");
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now()/1000 - authDate) > 86400) throw new Error("Telegram session expired. Reopen the app.");
  const dataCheckString = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const a = Buffer.from(calculated, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) throw new Error("Telegram signature verification failed.");
  const userText = params.get("user");
  if (!userText) throw new Error("Telegram user data is missing.");
  const user = JSON.parse(userText);
  if (!user.id) throw new Error("Telegram user ID is missing.");
  return { user, startParam: params.get("start_param") || "" };
}
function auth(req,res,next) {
  try {
    const verified = verifyTelegramInitData(req.get("X-Telegram-Init-Data"));
    req.telegram = verified;
    next();
  } catch(e) { res.status(401).json({error:e.message}); }
}
function getOrCreateUser(user, startParam) {
  const id = String(user.id);
  const exists = db.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").get(id);
  if (exists) {
    db.prepare("UPDATE users SET first_name=? WHERE telegram_id=?").run(String(user.first_name||"").slice(0,100),id);
    return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
  }
  let referrer = null;
  const match = /^ref_(\d+)$/.exec(startParam || "");
  if (match && match[1] !== id && db.prepare("SELECT telegram_id FROM users WHERE telegram_id=?").get(match[1])) referrer=match[1];
  const tx = db.transaction(()=>{
    db.prepare("INSERT INTO users(telegram_id,first_name,referred_by,created_at) VALUES(?,?,?,?)").run(id,String(user.first_name||"").slice(0,100),referrer,now());
    if (referrer && REFERRAL_POINTS > 0) {
      db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(REFERRAL_POINTS,referrer);
      db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)").run(referrer,REFERRAL_POINTS,"Referral bonus",now());
    }
  });
  tx();
  return db.prepare("SELECT * FROM users WHERE telegram_id=?").get(id);
}
const taskList = [{id:"daily",title:"Daily check-in",description:"Claim your daily points once per day.",points:DAILY_POINTS}];
function isAdmin(req,res,next) {
  const provided=req.get("X-Admin-Key")||"";
  if (!ADMIN_KEY || provided.length!==ADMIN_KEY.length || !crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(ADMIN_KEY))) return res.status(403).json({error:"Forbidden"});
  next();
}
app.get("/api/me",auth,(req,res)=>{
  const u=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const claims=db.prepare("SELECT task_id FROM task_claims WHERE telegram_id=?").all(u.telegram_id);
  const claimed=new Set(claims.map(x=>x.task_id));
  const ledger=db.prepare("SELECT delta,description,created_at FROM ledger WHERE telegram_id=? ORDER BY id DESC LIMIT 20").all(u.telegram_id);
  const username=process.env.BOT_USERNAME || "";
  const referralLink=username ? `https://t.me/${username}?startapp=ref_${u.telegram_id}` : `Set BOT_USERNAME in .env to create a shareable link`;
  res.json({user:{id:u.telegram_id,first_name:u.first_name,points:u.points},tasks:taskList.map(t=>({...t,completed:claimed.has(t.id)})),ledger,referralLink,config:{referralPoints:REFERRAL_POINTS,minWithdrawalPoints:MIN_WITHDRAWAL}});
});
app.post("/api/tasks/:id/claim",auth,(req,res)=>{
  const u=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const task=taskList.find(t=>t.id===req.params.id);
  if(!task) return res.status(404).json({error:"Task not found."});
  if(task.id==="daily") return res.status(400).json({error:"Use daily check-in for this task."});
  res.status(400).json({error:"No claimable task configured."});
});
app.post("/api/checkin",auth,(req,res)=>{
  const u=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const tx=db.transaction(()=>{
    const inserted=db.prepare("INSERT OR IGNORE INTO checkins(telegram_id,day) VALUES(?,?)").run(u.telegram_id,day());
    if(!inserted.changes) return false;
    db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(DAILY_POINTS,u.telegram_id);
    db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)").run(u.telegram_id,DAILY_POINTS,"Daily check-in",now());
    return true;
  });
  if(!tx()) return res.status(409).json({error:"Daily check-in already claimed today."});
  res.json({ok:true,points:DAILY_POINTS});
});
app.post("/api/withdrawals",auth,(req,res)=>{
  const u=getOrCreateUser(req.telegram.user,req.telegram.startParam);
  const points=Number(req.body?.points);
  const method=String(req.body?.method||"manual_review");
  const allowed=["manual_review","TON","USDT","KBZPay","WavePay"];
  if(!Number.isSafeInteger(points)||points<MIN_WITHDRAWAL) return res.status(400).json({error:`Minimum request is ${MIN_WITHDRAWAL} points.`});
  if(!allowed.includes(method)) return res.status(400).json({error:"Unsupported method."});
  const tx=db.transaction(()=>{
    const fresh=db.prepare("SELECT points FROM users WHERE telegram_id=?").get(u.telegram_id);
    if(fresh.points<points) throw new Error("Not enough points.");
    db.prepare("UPDATE users SET points=points-? WHERE telegram_id=?").run(points,u.telegram_id);
    const result=db.prepare("INSERT INTO withdrawals(telegram_id,points,method,status,created_at) VALUES(?,?,?,'pending',?)").run(u.telegram_id,points,method,now());
    db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)").run(u.telegram_id,-points,`Withdrawal request #${result.lastInsertRowid}`,now());
    return result.lastInsertRowid;
  });
  try { const id=tx(); res.json({ok:true,id,message:"Request submitted for manual review. This does not guarantee payout."}); }
  catch(e){res.status(400).json({error:e.message});}
});
app.get("/api/admin/withdrawals",isAdmin,(req,res)=>{
  res.json(db.prepare("SELECT * FROM withdrawals ORDER BY id DESC LIMIT 100").all());
});
app.post("/api/admin/withdrawals/:id",isAdmin,(req,res)=>{
  const status=String(req.body?.status||"");
  if(!["approved","rejected"].includes(status)) return res.status(400).json({error:"Status must be approved or rejected."});
  const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(Number(req.params.id));
  if(!w) return res.status(404).json({error:"Request not found."});
  if(w.status!=="pending") return res.status(409).json({error:"Request already reviewed."});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE withdrawals SET status=? WHERE id=?").run(status,w.id);
    if(status==="rejected"){
      db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(w.points,w.telegram_id);
      db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)").run(w.telegram_id,w.points,`Refund for rejected request #${w.id}`,now());
    }
  });
  tx();res.json({ok:true,status,note:"Status only; no money or cryptocurrency was transferred."});
});
app.get("/health",(req,res)=>res.json({ok:true,app:"SUN REWARD"}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>console.log(`SUN REWARD listening on port ${PORT}`));
