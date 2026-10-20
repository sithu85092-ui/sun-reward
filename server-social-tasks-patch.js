/*
SUN REWARD SOCIAL TASKS PATCH
Paste the database schema/seed near the existing db.exec(...) setup, after `const now = ...` is declared.
Paste the ROUTES section BEFORE the existing `app.get("*", ...)` fallback.
Then follow README.md to replace the existing taskList, /api/me tasks property, and old /api/tasks/:id/claim route.
Uses existing variables/functions in server.js: app, db, auth, isAdmin, getOrCreateUser, now.
*/

const socialTaskSchema = `
CREATE TABLE IF NOT EXISTS social_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_task_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  proof TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  review_note TEXT,
  UNIQUE(telegram_id, task_id)
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
db.exec(socialTaskSchema);

db.prepare(`
  INSERT OR IGNORE INTO social_tasks
  (id,title,description,url,points,enabled,created_at)
  VALUES (?,?,?,?,?,1,?)
`).run(
  "tiktok_follow",
  "Follow SUN REWARD on TikTok",
  "Follow @sun_reward, then submit a proof note for admin review.",
  "https://www.tiktok.com/@sun_reward",
  100,
  now()
);

db.prepare(`INSERT OR IGNORE INTO app_settings(key,value) VALUES (?,?)`)
  .run("telegram_url", "https://t.me/SUNREWARDCHANNEL");
db.prepare(`INSERT OR IGNORE INTO app_settings(key,value) VALUES (?,?)`)
  .run("tiktok_url", "https://www.tiktok.com/@sun_reward");

function validHttpUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function publicTaskRows(telegramId) {
  return db.prepare(`
    SELECT t.id,t.title,t.description,t.url,t.points,t.enabled,
      s.status AS submission_status
    FROM social_tasks t
    LEFT JOIN social_task_submissions s
      ON s.task_id=t.id AND s.telegram_id=?
    WHERE t.enabled=1
    ORDER BY t.created_at ASC
  `).all(String(telegramId)).map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    url: t.url,
    points: t.points,
    completed: t.submission_status === "approved",
    submissionStatus: t.submission_status || null,
    kind: "social"
  }));
}

// Public social links. No secrets are returned.
app.get("/api/public-settings", (req, res) => {
  const rows = db.prepare("SELECT key,value FROM app_settings").all();
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({
    tiktok_url: settings.tiktok_url || "https://www.tiktok.com/@sun_reward",
    telegram_url: settings.telegram_url || "https://t.me/SUNREWARDCHANNEL"
  });
});

// User submits a short proof note/link. No reward is given until admin approval.
app.post("/api/tasks/:id/submit", auth, (req, res) => {
  const user = getOrCreateUser(req.telegram.user, req.telegram.startParam);
  const taskId = String(req.params.id || "");
  const proof = String(req.body?.proof || "").trim().slice(0, 1000);
  const task = db.prepare("SELECT * FROM social_tasks WHERE id=? AND enabled=1").get(taskId);
  if (!task) return res.status(404).json({ error: "Task not found or disabled." });
  if (!proof) return res.status(400).json({ error: "Proof note is required." });

  const previous = db.prepare(
    "SELECT * FROM social_task_submissions WHERE telegram_id=? AND task_id=?"
  ).get(user.telegram_id, taskId);

  if (previous?.status === "approved")
    return res.status(409).json({ error: "This task has already been approved." });
  if (previous?.status === "pending")
    return res.status(409).json({ error: "Your submission is already waiting for admin review." });

  if (previous?.status === "rejected") {
    db.prepare(`
      UPDATE social_task_submissions
      SET proof=?, status='pending', created_at=?, reviewed_at=NULL, review_note=NULL
      WHERE id=?
    `).run(proof, now(), previous.id);
  } else {
    db.prepare(`
      INSERT INTO social_task_submissions(telegram_id,task_id,proof,status,created_at)
      VALUES(?,?,?,'pending',?)
    `).run(user.telegram_id, taskId, proof, now());
  }
  res.json({ ok: true, status: "pending", message: "Submitted. SUN will be awarded only after admin approval." });
});

// ADMIN: list/add/edit/delete/enable/disable tasks
app.get("/api/admin/social-tasks", isAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM social_tasks ORDER BY created_at DESC").all());
});

app.post("/api/admin/social-tasks", isAdmin, (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0,120);
  const description = String(req.body?.description || "").trim().slice(0,500);
  const url = String(req.body?.url || "").trim();
  const points = Number(req.body?.points);
  const id = String(req.body?.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0,60)
    || ("task_" + require("crypto").randomBytes(5).toString("hex"));
  if (!title || !validHttpUrl(url) || !Number.isSafeInteger(points) || points < 0 || points > 1000000)
    return res.status(400).json({ error: "Enter a title, valid HTTP(S) URL, and reward from 0 to 1,000,000." });
  try {
    db.prepare(`INSERT INTO social_tasks(id,title,description,url,points,enabled,created_at)
      VALUES(?,?,?,?,?,1,?)`).run(id,title,description,url,points,now());
    res.json({ ok:true, id });
  } catch (e) {
    res.status(409).json({ error: "Task ID already exists or task could not be created." });
  }
});

app.put("/api/admin/social-tasks/:id", isAdmin, (req, res) => {
  const id = String(req.params.id);
  const old = db.prepare("SELECT * FROM social_tasks WHERE id=?").get(id);
  if (!old) return res.status(404).json({ error:"Task not found." });
  const title = String(req.body?.title ?? old.title).trim().slice(0,120);
  const description = String(req.body?.description ?? old.description).trim().slice(0,500);
  const url = String(req.body?.url ?? old.url).trim();
  const points = Number(req.body?.points ?? old.points);
  const enabled = req.body?.enabled === undefined ? old.enabled : (req.body.enabled ? 1 : 0);
  if (!title || !validHttpUrl(url) || !Number.isSafeInteger(points) || points < 0 || points > 1000000)
    return res.status(400).json({ error:"Invalid title, URL or reward." });
  db.prepare(`UPDATE social_tasks SET title=?,description=?,url=?,points=?,enabled=? WHERE id=?`)
    .run(title,description,url,points,enabled,id);
  res.json({ ok:true });
});

app.delete("/api/admin/social-tasks/:id", isAdmin, (req, res) => {
  const id = String(req.params.id);
  const task = db.prepare("SELECT id FROM social_tasks WHERE id=?").get(id);
  if (!task) return res.status(404).json({ error:"Task not found." });
  // Keep submission history and avoid breaking old reviews: disable instead of hard delete.
  db.prepare("UPDATE social_tasks SET enabled=0 WHERE id=?").run(id);
  res.json({ ok:true, message:"Task disabled. Submission history was preserved." });
});

// ADMIN: edit public TikTok / Telegram links.
app.get("/api/admin/app-settings", isAdmin, (req,res) => {
  const rows = db.prepare("SELECT key,value FROM app_settings").all();
  res.json(Object.fromEntries(rows.map(r => [r.key,r.value])));
});

app.put("/api/admin/app-settings", isAdmin, (req,res) => {
  const keys = ["tiktok_url","telegram_url"];
  const tx = db.transaction(() => {
    for (const key of keys) {
      if (req.body?.[key] !== undefined) {
        const value = String(req.body[key] || "").trim();
        if (!validHttpUrl(value)) throw new Error(`${key} must be a valid HTTP(S) URL.`);
        db.prepare(`INSERT INTO app_settings(key,value) VALUES(?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key,value);
      }
    }
  });
  try { tx(); res.json({ok:true}); }
  catch(e) { res.status(400).json({error:e.message}); }
});

// ADMIN: review pending social submissions.
app.get("/api/admin/task-submissions", isAdmin, (req,res) => {
  const status = ["pending","approved","rejected"].includes(String(req.query.status)) ? String(req.query.status) : "pending";
  const rows = db.prepare(`
    SELECT s.id,s.telegram_id,s.task_id,s.proof,s.status,s.created_at,s.reviewed_at,s.review_note,
      t.title AS task_title,t.points AS reward
    FROM social_task_submissions s
    LEFT JOIN social_tasks t ON t.id=s.task_id
    WHERE s.status=?
    ORDER BY s.id ASC LIMIT 300
  `).all(status);
  res.json(rows);
});

app.post("/api/admin/task-submissions/:id/review", isAdmin, (req,res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "");
  const note = String(req.body?.note || "").trim().slice(0,500);
  if (!Number.isSafeInteger(id) || id < 1 || !["approved","rejected"].includes(status))
    return res.status(400).json({error:"Invalid submission ID or review status."});

  const tx = db.transaction(() => {
    const sub = db.prepare("SELECT * FROM social_task_submissions WHERE id=?").get(id);
    if (!sub) throw new Error("Submission not found.");
    if (sub.status !== "pending") throw new Error("Submission already reviewed.");
    const task = db.prepare("SELECT * FROM social_tasks WHERE id=?").get(sub.task_id);
    if (status === "approved") {
      if (!task) throw new Error("Task no longer exists.");
      // A single transaction plus pending-status check prevents duplicate awards.
      db.prepare("UPDATE users SET points=points+? WHERE telegram_id=?").run(task.points,sub.telegram_id);
      db.prepare("INSERT INTO ledger(telegram_id,delta,description,created_at) VALUES(?,?,?,?)")
        .run(sub.telegram_id,task.points,`Approved task: ${task.title}`,now());
    }
    db.prepare(`UPDATE social_task_submissions SET status=?,reviewed_at=?,review_note=? WHERE id=? AND status='pending'`)
      .run(status,now(),note,id);
    return { status, reward: status === "approved" ? Number(task.points) : 0 };
  });
  try {
    const result = tx();
    res.json({ok:true,...result, note: status === "approved" ? "Points added to ledger." : "Rejected; no points awarded."});
  } catch(e) { res.status(409).json({error:e.message}); }
});
