const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const $ = (id) => document.getElementById(id);
let me = null;
let config = { referralPoints: 50, minWithdrawalPoints: 1000 };
const demoMode = !tg || !tg.initData;

function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}
async function api(path, options={}) {
  const headers = { "Content-Type":"application/json", "X-Telegram-Init-Data": tg?.initData || "", ...(options.headers||{}) };
  const res = await fetch(path, {...options, headers});
  const data = await res.json().catch(()=>({error:"Unexpected server response"}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function demoUser() {
  const u = tg?.initDataUnsafe?.user;
  return u ? {id:u.id, first_name:u.first_name || "friend"} : {id:123456789, first_name:"Demo User"};
}
function renderTasks(tasks) {
  $("task-list").innerHTML = "";
  tasks.forEach(t => {
    const el = document.createElement("div"); el.className="card task";
    const left = document.createElement("div");
    const h = document.createElement("h3"); h.textContent=t.title;
    const p = document.createElement("p"); p.textContent=t.description;
    left.append(h,p);
    const right = document.createElement("div"); right.style.textAlign="right";
    const r = document.createElement("div"); r.className="reward"; r.textContent=`+${t.points} PTS`;
    const b = document.createElement("button"); b.textContent=t.completed ? "Done" : "Claim"; b.disabled=!!t.completed;
    b.style.cssText="margin-top:8px;padding:7px 10px;border:0;border-radius:9px;background:#293d6e;color:white";
    b.onclick=async()=>{try{if(demoMode){toast("Preview only. Open this app inside Telegram after deployment.");return;}await api(`/api/tasks/${encodeURIComponent(t.id)}/claim`,{method:"POST",body:"{}"});toast("Task claimed!");await refresh();}catch(e){toast(e.message)}};
    right.append(r,b);el.append(left,right);$("task-list").append(el);
  });
}
function renderLedger(rows) {
  $("ledger").innerHTML = rows.length ? "" : '<div class="card muted">No activity yet.</div>';
  rows.forEach(x=>{const el=document.createElement("div");el.className="ledger-row";const a=document.createElement("span");a.textContent=x.description;const b=document.createElement("strong");b.textContent=(x.delta>0?"+":"")+x.delta;el.append(a,b);$("ledger").append(el);});
}
async function refresh() {
  if (demoMode) {
    const user=demoUser(); $("hello").textContent=`Hello, ${user.first_name} · Preview mode`;
    $("points").textContent="0"; $("ref-link").value="Available after deployment";
    renderTasks([{id:"daily",title:"Daily check-in",description:"Open the app each day",points:5,completed:false}]);
    renderLedger([]); $("ref-points").textContent=config.referralPoints; return;
  }
  const data=await api("/api/me");
  me=data.user; config=data.config;
  $("hello").textContent=`Hello, ${me.first_name || "friend"}`;
  $("points").textContent=me.points;
  $("ref-link").value=data.referralLink;
  $("ref-points").textContent=config.referralPoints;
  renderTasks(data.tasks);renderLedger(data.ledger);
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("hidden",p.id!==b.dataset.tab));
}));
$("copy-ref").onclick=async()=>{try{await navigator.clipboard.writeText($("ref-link").value);toast("Referral link copied");}catch{ $("ref-link").select();toast("Select and copy your link");}};
$("checkin").onclick=async()=>{try{if(demoMode){toast("Preview only — daily points need the live backend.");return;}await api("/api/checkin",{method:"POST",body:"{}"});toast("Check-in complete");await refresh();}catch(e){toast(e.message)}};
$("withdraw").onclick=async()=>{try{if(demoMode){toast("Preview only — requests need the live backend.");return;}const points=Number($("withdraw-points").value);const method=$("withdraw-method").value;if(!Number.isInteger(points)||points<=0)throw new Error("Enter a valid points amount.");const d=await api("/api/withdrawals",{method:"POST",body:JSON.stringify({points,method})});$("withdraw-note").textContent=d.message;toast("Request submitted");await refresh();}catch(e){toast(e.message)}};
refresh().catch(e=>{ $("hello").textContent="Could not connect to server";toast(e.message);});
