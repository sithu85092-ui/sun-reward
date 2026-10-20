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

    if (task.kind === "daily") {
      button.textContent = task.completed ? "Done" : "Check in";
      button.disabled = Boolean(task.completed);
      button.addEventListener("click", async () => {
        try {
          await api("/api/checkin", {method:"POST", body:"{}"});
          toast("Daily check-in အောင်မြင်ပါပြီ။");
          await refresh();
        } catch (error) { showError(error); }
      });
    } else if (task.completed || task.submissionStatus === "approved") {
      button.textContent = "Approved";
      button.disabled = true;
    } else if (task.submissionStatus === "pending") {
      button.textContent = "Under review";
      button.disabled = true;
    } else {
      button.textContent = task.submissionStatus === "rejected" ? "Resubmit proof" : "Open & submit proof";
      button.addEventListener("click", async () => {
        try {
          if (task.url && /^https?:\/\//i.test(task.url)) window.open(task.url, "_blank", "noopener,noreferrer");
          const proof = prompt("လုပ်ဆောင်ပြီးကြောင်း အထောက်အထား/မှတ်ချက် ထည့်ပါ။ Admin စစ်ဆေးပြီးမှ SUN ပေးပါမည်။");
          if (proof === null) return;
          await api(`/api/tasks/${encodeURIComponent(task.id)}/submit`, {
            method:"POST", body:JSON.stringify({proof})
          });
          toast("တင်ပြပြီးပါပြီ။ Admin အတည်ပြုရန် စောင့်ပါ။");
          await refresh();
        } catch (error) { showError(error); }
      });
    }

    right.append(reward, button);
    card.append(left, right);
    container.append(card);
  });
}
