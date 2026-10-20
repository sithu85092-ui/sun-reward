(() => {
  const $ = id => document.getElementById(id);
  let key = sessionStorage.getItem("sun_admin_key") || "";
  $("admin-key").value = key;

  function say(message, bad=false) {
    $("message").textContent = message || "";
    $("message").style.color = bad ? "#ff9999" : "#ffd166";
  }
  async function request(path, options={}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type":"application/json",
        "X-Admin-Key":key,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  async function connect() {
    key = $("admin-key").value.trim();
    if (!key) throw new Error("Enter ADMIN_KEY first.");
    // Validate the key against an admin-only endpoint.
    await request("/api/admin/social-tasks");
    sessionStorage.setItem("sun_admin_key", key);
    $("connection").textContent = "Connected successfully";
    await Promise.all([loadTasks(), loadLinks(), loadSubmissions()]);
    say("Connected.");
  }
  async function loadTasks() {
    const tasks = await request("/api/admin/social-tasks");
    const list = $("task-list"); list.replaceChildren();
    if (!tasks.length) list.append(el("p","No tasks yet.","muted"));
    tasks.forEach(task => {
      const card = el("article",undefined,"item");
      card.append(el("h3",`${task.title} · ${Number(task.points)} SUN`));
      card.append(el("p",`${task.id} · ${task.enabled ? "Enabled" : "Disabled"}`));
      card.append(el("p",task.url));
      card.append(el("p",task.description || ""));
      const actions = el("div",undefined,"actions");
      const edit = el("button","Edit","secondary");
      edit.onclick = async () => {
        const title = prompt("Task title",task.title); if (title===null) return;
        const description = prompt("Description",task.description); if (description===null) return;
        const url = prompt("URL",task.url); if (url===null) return;
        const points = prompt("Reward in SUN",String(task.points)); if (points===null) return;
        const enabled = confirm("Press OK to enable this task; Cancel to disable it.");
        try {
          await request(`/api/admin/social-tasks/${encodeURIComponent(task.id)}`,{
            method:"PUT",body:JSON.stringify({title,description,url,points:Number(points),enabled})
          });
          say("Task updated."); await loadTasks();
        } catch(e){say(e.message,true);}
      };
      const disable = el("button","Disable / Archive","danger");
      disable.disabled = !task.enabled;
      disable.onclick = async () => {
        if (!confirm("Disable this task? History will be preserved.")) return;
        try { await request(`/api/admin/social-tasks/${encodeURIComponent(task.id)}`,{method:"DELETE"}); say("Task disabled."); await loadTasks(); }
        catch(e){say(e.message,true);}
      };
      actions.append(edit,disable); card.append(actions); list.append(card);
    });
  }
  async function loadLinks() {
    const settings = await request("/api/admin/app-settings");
    $("tiktok-url").value = settings.tiktok_url || "https://www.tiktok.com/@sun_reward";
    $("telegram-url").value = settings.telegram_url || "https://t.me/SUNREWARDCHANNEL";
  }
  async function loadSubmissions() {
    const status = $("submission-status").value;
    const rows = await request(`/api/admin/task-submissions?status=${encodeURIComponent(status)}`);
    const list = $("submission-list"); list.replaceChildren();
    if (!rows.length) list.append(el("p","No submissions for this status.","muted"));
    rows.forEach(row => {
      const card = el("article",undefined,"item");
      card.append(el("h3",`${row.task_title || row.task_id} · ${row.status}`));
      card.append(el("p",`User Telegram ID: ${row.telegram_id} · Reward: ${row.reward ?? "Task removed"} SUN`));
      card.append(el("p",`Submitted: ${row.created_at}`));
      card.append(el("p",`Proof: ${row.proof}`));
      if (row.review_note) card.append(el("p",`Review note: ${row.review_note}`));
      if (row.status === "pending") {
        const actions = el("div",undefined,"actions");
        const approve = el("button","Approve");
        approve.onclick = async () => {
          if (!confirm("Approve this proof and credit the task reward?")) return;
          try { await request(`/api/admin/task-submissions/${row.id}/review`,{method:"POST",body:JSON.stringify({status:"approved"})}); say("Approved; points credited."); await loadSubmissions(); }
          catch(e){say(e.message,true);}
        };
        const reject = el("button","Reject","danger");
        reject.onclick = async () => {
          const note = prompt("Reason (optional)","Please submit valid proof."); if (note===null) return;
          try { await request(`/api/admin/task-submissions/${row.id}/review`,{method:"POST",body:JSON.stringify({status:"rejected",note})}); say("Rejected; no points awarded."); await loadSubmissions(); }
          catch(e){say(e.message,true);}
        };
        actions.append(approve,reject); card.append(actions);
      }
      list.append(card);
    });
  }
  $("connect").onclick = async () => { try { await connect(); } catch(e){ $("connection").textContent="Connection failed"; say(e.message,true); } };
  document.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b===button));
    ["tasks","links","submissions"].forEach(name=>$(`tab-${name}`).classList.toggle("hidden",name!==button.dataset.tab));
  });
  $("task-form").onsubmit = async event => {
    event.preventDefault();
    try {
      const body = {
        id:$("task-id").value.trim(),
        title:$("task-title").value.trim(),
        description:$("task-description").value.trim(),
        url:$("task-url").value.trim(),
        points:Number($("task-points").value)
      };
      await request("/api/admin/social-tasks",{method:"POST",body:JSON.stringify(body)});
      $("task-form").reset(); $("task-points").value="100"; say("Task added."); await loadTasks();
    } catch(e){say(e.message,true);}
  };
  $("links-form").onsubmit = async event => {
    event.preventDefault();
    try {
      await request("/api/admin/app-settings",{method:"PUT",body:JSON.stringify({
        tiktok_url:$("tiktok-url").value.trim(),telegram_url:$("telegram-url").value.trim()
      })});
      say("Links saved.");
    } catch(e){say(e.message,true);}
  };
  $("load-submissions").onclick = () => loadSubmissions().catch(e=>say(e.message,true));
  $("submission-status").onchange = () => loadSubmissions().catch(e=>say(e.message,true));
  if (key) $("connection").textContent = "Saved key found; tap Connect to verify.";
})();
