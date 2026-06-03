const state = {
  user: null,
  data: null,
  view: "dashboard",
  lastParsed: null,
};

const viewTitles = {
  dashboard: ["PetCare Cloud", "今日待办"],
  pets: ["Pet Profile", "宠物档案"],
  chat: ["LLM Parser", "聊天式记录"],
  logs: ["HealthLog", "健康日志"],
  reminders: ["Reminder", "提醒管理"],
  recommend: ["Pet Match", "养宠选择推荐"],
  cloud: ["Cloud Architecture", "云计算架构"],
};

const recordLabels = {
  health: "健康",
  medicine: "用药",
  diet: "饮食",
  vaccine: "疫苗",
  deworm: "驱虫",
  diary: "日常",
};

const severityLabels = {
  low: "低",
  medium: "中",
  high: "高",
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function petName(id) {
  return state.data?.pets.find((pet) => pet.id === id)?.name || "未知宠物";
}

function petInitial(name) {
  return String(name || "P").slice(0, 1).toUpperCase();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  const [eyebrow, title] = viewTitles[view];
  document.getElementById("viewEyebrow").textContent = eyebrow;
  document.getElementById("viewTitle").textContent = title;
}

async function loadState() {
  state.data = await api("/api/state");
  renderAll();
}

function renderAll() {
  if (!state.data) return;
  document.getElementById("currentUser").textContent = state.user?.username || "demo";
  document.getElementById("parserMode").textContent = `Parser: ${state.data.cloud.llm}`;
  renderMetrics();
  renderDashboard();
  renderPets();
  renderLogs();
  renderReminders();
  renderChat();
  renderCloud();
}

function renderMetrics() {
  const metrics = [
    ["宠物数量", state.data.stats.pet_count],
    ["今日待办", state.data.stats.pending_today],
    ["日志总数", state.data.stats.log_count],
    ["异常记录", state.data.stats.abnormal_count],
  ];
  document.getElementById("metricGrid").innerHTML = metrics
    .map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function renderDashboard() {
  const pending = state.data.reminders.filter((item) => item.status === "pending").slice(0, 6);
  document.getElementById("pendingCount").textContent = `${pending.length} pending`;
  document.getElementById("dashboardReminders").innerHTML = pending.length
    ? pending.map(reminderItem).join("")
    : `<div class="empty">暂无待办提醒</div>`;

  const logs = state.data.logs.slice(0, 7);
  document.getElementById("dashboardLogs").innerHTML = logs.length
    ? logs.map(logItem).join("")
    : `<div class="empty">暂无健康日志</div>`;
}

function reminderItem(item) {
  const status = item.status === "done" ? "已完成" : "待处理";
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(petName(item.pet_id))} · ${formatDateTime(item.reminder_time)}</p>
        </div>
        <span class="badge">${status}</span>
      </div>
      ${
        item.status === "pending"
          ? `<button class="ghost-action complete-reminder" data-id="${item.id}">完成</button>`
          : ""
      }
    </article>
  `;
}

function logItem(item) {
  const severity = item.severity || "low";
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <h4>${escapeHtml(petName(item.pet_id))} · ${recordLabels[item.record_type] || item.record_type}</h4>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <span class="badge ${severity}">${severityLabels[severity] || severity}</span>
      </div>
    </article>
  `;
}

function renderPets() {
  const grid = document.getElementById("petGrid");
  grid.innerHTML = state.data.pets
    .map((pet) => {
      const avatar = pet.avatar_url
        ? `<img class="pet-avatar" src="${pet.avatar_url}" alt="${escapeHtml(pet.name)}" />`
        : `<div class="pet-avatar">${escapeHtml(petInitial(pet.name))}</div>`;
      return `
        <article class="pet-card">
          <div class="pet-head">
            <div>
              <h4>${escapeHtml(pet.name)}</h4>
              <p>${escapeHtml(pet.species)} · ${escapeHtml(pet.breed || "未填写品种")}</p>
            </div>
            ${avatar}
          </div>
          <p>生日：${escapeHtml(pet.birthday || "未填写")} · 体重：${escapeHtml(pet.weight || "-")} kg</p>
          <p>${escapeHtml(pet.notes || "暂无备注")}</p>
          <div class="upload-row">
            <input type="file" accept="image/*" class="avatar-input" data-id="${pet.id}" />
          </div>
        </article>
      `;
    })
    .join("");
}

function renderChat() {
  const stream = document.getElementById("chatStream");
  const messages = [...state.data.messages].reverse();
  stream.innerHTML = messages.length
    ? messages
        .map(
          (message) => `
          <div class="bubble user">${escapeHtml(message.raw_content)}</div>
          <div class="bubble ai">${escapeHtml(message.parsed_result.reply || "已记录")}</div>
        `
        )
        .join("")
    : `<div class="empty">暂无聊天记录</div>`;
  stream.scrollTop = stream.scrollHeight;
  document.getElementById("parseJson").textContent = JSON.stringify(state.lastParsed || {}, null, 2);
}

function renderLogs() {
  document.getElementById("logTable").innerHTML = state.data.logs
    .map((item) => {
      const severity = item.severity || "low";
      return `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(petName(item.pet_id))}</td>
          <td>${recordLabels[item.record_type] || escapeHtml(item.record_type)}</td>
          <td><span class="badge ${severity}">${severityLabels[severity] || severity}</span></td>
          <td>${escapeHtml(item.summary)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderReminders() {
  const list = document.getElementById("reminderList");
  list.innerHTML = state.data.reminders.length
    ? state.data.reminders.map(reminderItem).join("")
    : `<div class="empty">暂无提醒任务</div>`;
}

function renderCloud() {
  const labels = {
    ecs: "ECS 云服务器",
    database: "业务数据库",
    object_storage: "对象存储 OBS",
    llm: "LLM 解析",
    worker: "异步 Worker",
  };
  document.getElementById("cloudStatus").innerHTML = Object.entries(state.data.cloud)
    .map(
      ([key, value]) => `
      <article class="cloud-node">
        <strong>${labels[key] || key}</strong>
        <span>${escapeHtml(value)}</span>
      </article>
    `
    )
    .join("");
}

async function handleLogin(event) {
  event.preventDefault();
  const payload = {
    username: document.getElementById("loginUsername").value,
    password: document.getElementById("loginPassword").value,
  };
  const result = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.user = result.user;
  state.data = result.state;
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  setView("dashboard");
  renderAll();
}

async function handlePetSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const result = await api("/api/pets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.data = result.state;
  event.currentTarget.reset();
  renderAll();
}

async function sendChat(content) {
  const result = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ content, input_type: "text" }),
  });
  state.lastParsed = result.parsed;
  state.data = result.state;
  renderAll();
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  await sendChat(content);
}

async function handleRecommend(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const result = await api("/api/recommend", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  document.getElementById("recommendResult").innerHTML = result.recommendations
    .map(
      (item) => `
        <article class="result-card">
          <div class="item-head">
            <h4>${escapeHtml(item.name)}</h4>
            <span class="badge">${item.score} 分</span>
          </div>
          <p>${escapeHtml(item.reason)}</p>
          <p>${escapeHtml(item.care_plan)}</p>
        </article>
      `
    )
    .join("");
}

async function completeReminder(id) {
  const result = await api(`/api/reminders/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.data = result.state;
  renderAll();
}

async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const result = await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        pet_id: input.dataset.id,
        filename: file.name,
        mime: file.type,
        data_url: reader.result,
      }),
    });
    state.data = result.state;
    renderAll();
  };
  reader.readAsDataURL(file);
}

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("petForm").addEventListener("submit", handlePetSubmit);
  document.getElementById("chatForm").addEventListener("submit", handleChatSubmit);
  document.getElementById("recommendForm").addEventListener("submit", handleRecommend);
  document.getElementById("refreshBtn").addEventListener("click", loadState);
  document.getElementById("quickChatBtn").addEventListener("click", () => setView("chat"));

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  document.body.addEventListener("click", async (event) => {
    const sampleButton = event.target.closest("[data-sample]");
    if (sampleButton) {
      await sendChat(sampleButton.dataset.sample);
    }
    const completeButton = event.target.closest(".complete-reminder");
    if (completeButton) {
      await completeReminder(completeButton.dataset.id);
    }
  });

  document.body.addEventListener("change", async (event) => {
    if (event.target.matches(".avatar-input")) {
      await uploadAvatar(event.target);
    }
  });
}

bindEvents();
