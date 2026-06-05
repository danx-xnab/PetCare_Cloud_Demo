// ===== State =====
const state = {
  user: null,
  data: null,
  view: "dashboard",
  lastParsed: null,
  allLogs: [],   // unfiltered copy for client-side filtering
  dashboardReminderFilter: "pending",
};

let confirmResolver = null;

const viewTitles = {
  dashboard: ["PetCare Cloud", "今日待办"],
  pets:      ["Pet Profile",   "宠物档案"],
  chat:      ["LLM Parser",    "聊天式记录"],
  logs:      ["HealthLog",     "健康日志"],
  reminders: ["Reminder",      "提醒管理"],
  recommend: ["Pet Match",     "养宠选择推荐"],
  cloud:     ["Cloud Architecture", "云计算架构"],
};

const recordLabels = {
  health:   "健康",
  medicine: "用药",
  diet:     "饮食",
  vaccine:  "疫苗",
  deworm:   "驱虫",
  diary:    "日常",
};

const severityLabels = { low: "低", medium: "中", high: "高" };

const speciesEmoji = {
  "猫": "🐱", "狗": "🐕", "兔子": "🐰", "仓鼠": "🐹",
  "龙猫": "🐭", "鹦鹉": "🦜", "鱼": "🐟", "乌龟": "🐢",
};

// ===== API helper =====

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

// ===== Utilities =====

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDateTimeLocal(value) {
  // Returns YYYY-MM-DDTHH:MM suitable for datetime-local inputs
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function petName(id) {
  return state.data?.pets.find((p) => p.id === id)?.name || "未知宠物";
}

function petEmoji(id) {
  const pet = state.data?.pets.find((p) => p.id === id);
  return speciesEmoji[pet?.species] || "🐾";
}

function showConfirm({ title = "确认操作", message = "确定继续吗？", okText = "确认" } = {}) {
  const modal = document.getElementById("confirmModal");
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  document.getElementById("confirmOk").textContent = okText;
  modal.classList.remove("hidden");
  document.getElementById("confirmCancel").focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result = false) {
  const modal = document.getElementById("confirmModal");
  modal.classList.add("hidden");
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove("hidden");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add("hidden"), 3000);
}

function setLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn._orig = btn.textContent;
    btn.textContent = text || "处理中…";
  } else {
    btn.textContent = btn._orig || btn.textContent;
  }
}

// ===== Navigation =====

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  document.querySelectorAll(".view").forEach((s) =>
    s.classList.toggle("active", s.id === `view-${view}`)
  );
  const [eyebrow, title] = viewTitles[view] || ["", view];
  document.getElementById("viewEyebrow").textContent = eyebrow;
  document.getElementById("viewTitle").textContent = title;

  if (view === "logs") renderLogsFiltered();
  if (view === "reminders") populateReminderPetSelect();
}

// ===== Data loading =====

async function loadState() {
  state.data = await api("/api/state");
  state.allLogs = [...(state.data.logs || [])];
  renderAll();
}

function renderAll() {
  if (!state.data) return;
  document.getElementById("currentUser").textContent = state.user?.username || "demo";
  updateLlmStatus();
  renderMetrics();
  renderDashboard();
  renderPets();
  renderLogs();
  renderReminders();
  renderChat();
  renderCloud();
  populateLogFilters();
  populateReminderPetSelect();
}

// ===== LLM status indicator =====

function updateLlmStatus() {
  const available = state.data?.llm_available;
  const connected = state.data?.llm_connected;
  const dot = document.getElementById("llmDot");
  const label = document.getElementById("parserMode");
  if (connected) {
    dot.className = "llm-dot online";
    label.textContent = "LLM 已接入";
    label.title = "";
  } else if (available) {
    dot.className = "llm-dot offline";
    label.textContent = "LLM 配置异常";
    label.title = state.data?.llm_error || "";
  } else {
    dot.className = "llm-dot offline";
    label.textContent = "规则解析";
    label.title = "";
  }
}

// ===== Metrics =====

function renderMetrics() {
  const s = state.data.stats;
  const metrics = [
    ["🐾 宠物数量", s.pet_count],
    ["⏰ 今日待办", s.pending_today],
    ["📋 日志总数", s.log_count],
    ["⚠️ 异常记录", s.abnormal_count],
  ];
  document.getElementById("metricGrid").innerHTML = metrics
    .map(([label, value]) =>
      `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`
    ).join("");
}

// ===== Dashboard =====

function renderDashboard() {
  const reminders = sortRemindersByTime(state.data.reminders || []);
  const buckets = {
    pending: reminders.filter((r) => reminderStatus(r) === "pending"),
    done: reminders.filter((r) => reminderStatus(r) === "done"),
    overdue: reminders.filter((r) => reminderStatus(r) === "overdue"),
  };
  const labels = {
    pending: "待处理",
    done: "已完成",
    overdue: "已过期",
  };
  if (!labels[state.dashboardReminderFilter]) {
    state.dashboardReminderFilter = "pending";
  }
  const activeItems = buckets[state.dashboardReminderFilter];
  document.getElementById("pendingCount").textContent =
    `${buckets.pending.length} 待处理 / ${buckets.done.length} 已完成 / ${buckets.overdue.length} 已过期`;
  document.getElementById("dashboardReminders").innerHTML = reminders.length
    ? `
      <div class="reminder-tabs" role="tablist" aria-label="待办分类">
        ${Object.entries(labels).map(([key, label]) => `
          <button
            class="reminder-tab ${state.dashboardReminderFilter === key ? "active" : ""}"
            type="button"
            data-dashboard-reminder-filter="${key}"
            role="tab"
            aria-selected="${state.dashboardReminderFilter === key}"
          >
            <span>${label}</span>
            <strong>${buckets[key].length}</strong>
          </button>`).join("")}
      </div>
      <div class="list">
        ${activeItems.length ? activeItems.map(reminderItem).join("") : `<div class="empty small">暂无${labels[state.dashboardReminderFilter]}提醒</div>`}
      </div>`
    : `<div class="empty">暂无待办提醒 🎉</div>`;

  const logs = state.data.logs.slice(0, 7);
  document.getElementById("dashboardLogs").innerHTML = logs.length
    ? logs.map(logTimelineItem).join("")
    : `<div class="empty">暂无健康日志</div>`;
}

function reminderTime(item) {
  const time = new Date(item.reminder_time || "").getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function sortRemindersByTime(items) {
  return [...items].sort((a, b) => reminderTime(a) - reminderTime(b));
}

function reminderStatus(item) {
  if (item.status === "done") return "done";
  return reminderTime(item) < Date.now() ? "overdue" : "pending";
}

function reminderItem(item) {
  const status = reminderStatus(item);
  const done = status === "done";
  const overdue = status === "overdue";
  const badgeText = done ? "已完成" : overdue ? "已过期" : "待处理";
  return `
    <article class="item ${done ? "done" : ""} ${overdue ? "overdue" : ""}">
      <div class="item-head">
        <div>
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(petName(item.pet_id))} · ${formatDateTime(item.reminder_time)}
            ${overdue ? '<span class="overdue-badge">逾期</span>' : ""}
          </p>
        </div>
        <span class="badge ${done ? "done" : ""} ${overdue ? "overdue" : ""}">${badgeText}</span>
      </div>
      <div class="item-actions">
        ${!done ? `<button class="ghost-action small complete-reminder" data-id="${item.id}">✓ 完成</button>` : ""}
        <button class="ghost-action small danger delete-reminder" data-id="${item.id}">✕ 删除</button>
      </div>
    </article>`;
}

function logTimelineItem(item) {
  const severity = item.severity || "low";
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <h4>${escapeHtml(petEmoji(item.pet_id))} ${escapeHtml(petName(item.pet_id))} · ${recordLabels[item.record_type] || item.record_type}</h4>
          <p>${escapeHtml(item.summary)}</p>
        </div>
        <span class="badge ${severity}">${severityLabels[severity] || severity}</span>
      </div>
    </article>`;
}

// ===== Pets =====

function renderPets() {
  const grid = document.getElementById("petGrid");
  if (!state.data.pets.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">还没有宠物，在左侧表单添加第一只吧 🐾</div>`;
    return;
  }
  grid.innerHTML = state.data.pets.map((pet) => {
    const emoji = speciesEmoji[pet.species] || "🐾";
    const avatar = pet.avatar_url
      ? `<img class="pet-avatar" src="${pet.avatar_url}" alt="${escapeHtml(pet.name)}" />`
      : `<div class="pet-avatar">${emoji}</div>`;
    return `
      <article class="pet-card" data-id="${pet.id}">
        <div class="pet-head">
          <div>
            <h4>${escapeHtml(pet.name)}</h4>
            <p>${escapeHtml(pet.species)}${pet.breed ? " · " + escapeHtml(pet.breed) : ""}</p>
          </div>
          ${avatar}
        </div>
        <p>🎂 ${escapeHtml(pet.birthday || "未填写")} &nbsp;⚖️ ${pet.weight ? pet.weight + " kg" : "-"}</p>
        <p>${escapeHtml(pet.notes || "暂无备注")}</p>
        <div class="upload-row">
          <input type="file" accept="image/*" class="avatar-input" data-id="${pet.id}" />
        </div>
        <div class="item-actions" style="margin-top:10px">
          <button class="ghost-action small summarize-pet" data-id="${pet.id}">📊 摘要</button>
          <button class="ghost-action small edit-pet" data-id="${pet.id}">✏️ 编辑</button>
          <button class="ghost-action small danger delete-pet" data-id="${pet.id}">🗑️ 删除</button>
        </div>
      </article>`;
  }).join("");
}

async function showPetSummary(petId) {
  const pet = state.data.pets.find((p) => p.id === petId);
  const btn = document.querySelector(`.summarize-pet[data-id="${petId}"]`);
  setLoading(btn, true, "分析中…");
  try {
    const result = await api(`/api/pets/${petId}/summarize`, { method: "POST", body: JSON.stringify({}) });
    const src = result._source === "llm" ? "🤖 LLM 生成" : "📐 规则生成";
    const highlights = (result.highlights || []).map((h) => `• ${escapeHtml(h)}`).join("\n");
    const suggestions = (result.suggestions || []).map((s) => `• ${escapeHtml(s)}`).join("\n");
    alert(
      `📊 ${escapeHtml(result.pet_name)} 健康摘要（${src}）\n\n` +
      `${escapeHtml(result.summary)}\n\n` +
      (highlights ? `【近期动态】\n${highlights}\n\n` : "") +
      (suggestions ? `【护理建议】\n${suggestions}` : "")
    );
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function startEditPet(petId) {
  const pet = state.data.pets.find((p) => p.id === petId);
  if (!pet) return;
  document.getElementById("editingPetId").value = petId;
  document.getElementById("petName").value = pet.name || "";
  document.getElementById("petSpecies").value = pet.species || "猫";
  document.getElementById("petBreed").value = pet.breed || "";
  document.getElementById("petBirthday").value = pet.birthday || "";
  document.getElementById("petWeight").value = pet.weight || "";
  document.getElementById("petNotes").value = pet.notes || "";
  document.getElementById("petFormTitle").textContent = `编辑：${pet.name}`;
  document.getElementById("petSubmitBtn").textContent = "保存修改";
  document.getElementById("petCancelBtn").style.display = "";
  // Scroll to the form
  document.getElementById("petForm").scrollIntoView({ behavior: "smooth" });
}

function cancelEditPet() {
  document.getElementById("editingPetId").value = "";
  document.getElementById("petForm").reset();
  document.getElementById("petFormTitle").textContent = "新增宠物";
  document.getElementById("petSubmitBtn").textContent = "保存宠物档案";
  document.getElementById("petCancelBtn").style.display = "none";
}

async function handlePetSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById("petSubmitBtn");
  setLoading(btn, true);
  try {
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const editId = document.getElementById("editingPetId").value;
    let result;
    if (editId) {
      result = await api(`/api/pets/${editId}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      result = await api("/api/pets", { method: "POST", body: JSON.stringify(payload) });
    }
    state.data = result.state;
    state.allLogs = [...(state.data.logs || [])];
    cancelEditPet();
    renderAll();
    showToast(editId ? "宠物档案已更新" : "宠物档案已添加", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function deletePet(petId) {
  const pet = state.data.pets.find((p) => p.id === petId);
  if (!confirm(`确定删除「${pet?.name || petId}」？相关日志和提醒也会一并删除。`)) return;
  try {
    const result = await api(`/api/pets/${petId}`, { method: "DELETE" });
    state.data = result.state;
    state.allLogs = [...(state.data.logs || [])];
    renderAll();
    showToast("已删除宠物", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ===== Chat =====

function renderChat() {
  const stream = document.getElementById("chatStream");
  const messages = [...state.data.messages].reverse();
  if (!messages.length) {
    stream.innerHTML = `<div class="empty">暂无聊天记录，试试点击上方示例</div>`;
    return;
  }
  stream.innerHTML = messages.map((msg) => {
    const parsed = msg.parsed_result || {};
    return `
      <div class="bubble user">
        <span>${escapeHtml(msg.raw_content)}</span>
        <time>${formatDateTime(msg.created_at)}</time>
      </div>
      <div class="bubble ai">
        <span>${escapeHtml(parsed.reply || "已记录")}</span>
        <time>${formatDateTime(msg.created_at)}</time>
      </div>`;
  }).join("");
  stream.scrollTop = stream.scrollHeight;

  // Update parse panel
  document.getElementById("parseJson").textContent =
    JSON.stringify(state.lastParsed || {}, null, 2);
  const badge = document.getElementById("parserBadge");
  badge.textContent = state.lastParsed?._parser === "llm" ? "LLM" : "rule";
  badge.className = state.lastParsed?._parser === "llm" ? "badge-llm" : "";
}

async function sendChat(content) {
  const btn = document.getElementById("chatSendBtn");
  setLoading(btn, true, "发送中…");

  // Optimistic: show user bubble immediately
  const stream = document.getElementById("chatStream");
  const tmpId = `tmp-${Date.now()}`;
  const tmp = document.createElement("div");
  tmp.id = tmpId;
  tmp.innerHTML = `
    <div class="bubble user"><span>${escapeHtml(content)}</span></div>
    <div class="bubble ai thinking"><span>AI 分析中…</span></div>`;
  stream.appendChild(tmp);
  stream.scrollTop = stream.scrollHeight;

  try {
    const result = await api("/api/chat", { method: "POST", body: JSON.stringify({ content, input_type: "text" }) });
    state.lastParsed = result.parsed;
    state.data = result.state;
    state.allLogs = [...(state.data.logs || [])];
    renderAll();
    showToast("已记录：" + (result.parsed?.summary?.slice(0, 30) || ""), "success");
  } catch (err) {
    document.getElementById(tmpId)?.remove();
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("chatInput");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  await sendChat(content);
}

// ===== Voice Input =====

let voiceRecognition = null;
let voiceStopRequested = false;
let voiceBaseText = "";

function resetVoiceButton() {
  const btn = document.getElementById("voiceBtn");
  btn.textContent = "🎤";
  btn.title = "语音输入";
  btn.classList.remove("recording");
}

function stopVoice() {
  if (!voiceRecognition) return;
  voiceStopRequested = true;
  const btn = document.getElementById("voiceBtn");
  btn.title = "正在停止语音输入";
  try {
    voiceRecognition.stop();
  } catch {
    voiceRecognition.abort();
  }
}

function startVoice() {
  if (voiceRecognition) {
    stopVoice();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("当前浏览器不支持语音输入（建议使用 Chrome / Edge）", "error");
    return;
  }
  const btn = document.getElementById("voiceBtn");
  const recognition = new SpeechRecognition();
  voiceRecognition = recognition;
  voiceStopRequested = false;
  voiceBaseText = document.getElementById("chatInput").value.trim();

  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    btn.textContent = "■";
    btn.title = "点击停止语音输入";
    btn.classList.add("recording");
  };
  recognition.onresult = (e) => {
    let finalText = "";
    let interimText = "";
    for (let i = 0; i < e.results.length; i += 1) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    const spokenText = `${finalText}${interimText}`.trim();
    document.getElementById("chatInput").value =
      [voiceBaseText, spokenText].filter(Boolean).join(" ");
  };
  recognition.onerror = (e) => {
    if (e.error === "aborted" && voiceStopRequested) return;
    const label = e.error === "no-speech" ? "没有识别到语音" : `语音识别失败：${e.error}`;
    showToast(label, "error");
  };
  recognition.onend = () => {
    if (voiceRecognition === recognition) {
      voiceRecognition = null;
      voiceStopRequested = false;
      voiceBaseText = "";
      resetVoiceButton();
    }
  };

  try {
    recognition.start();
  } catch (err) {
    voiceRecognition = null;
    voiceStopRequested = false;
    voiceBaseText = "";
    resetVoiceButton();
    showToast("语音识别启动失败：" + err.message, "error");
  }
}

// ===== Logs =====

function populateLogFilters() {
  const petSelect = document.getElementById("logPetFilter");
  const currentPet = petSelect.value;
  petSelect.innerHTML = `<option value="">全部宠物</option>` +
    (state.data.pets || []).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  petSelect.value = currentPet;
}

function renderLogs() {
  state.allLogs = [...(state.data.logs || [])];
  renderLogsFiltered();
}

function renderLogsFiltered() {
  const petId = document.getElementById("logPetFilter")?.value || "";
  const type = document.getElementById("logTypeFilter")?.value || "";
  let logs = state.allLogs;
  if (petId) logs = logs.filter((l) => l.pet_id === petId);
  if (type) logs = logs.filter((l) => l.record_type === type);

  document.getElementById("logTable").innerHTML = logs.map((item) => {
    const severity = item.severity || "low";
    let symptomsArr = [];
    try { symptomsArr = JSON.parse(item.symptoms || "[]"); } catch { /* ignore */ }
    return `
      <tr>
        <td>${escapeHtml(item.date)}</td>
        <td>${escapeHtml(petEmoji(item.pet_id))} ${escapeHtml(petName(item.pet_id))}</td>
        <td>${recordLabels[item.record_type] || escapeHtml(item.record_type)}</td>
        <td><span class="badge ${severity}">${severityLabels[severity] || severity}</span></td>
        <td>
          ${escapeHtml(item.summary)}
          ${symptomsArr.length ? `<span class="symptom-tags">${symptomsArr.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join("")}</span>` : ""}
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="5" class="empty-cell">暂无记录</td></tr>`;
}

// ===== Reminders =====

function populateReminderPetSelect() {
  const select = document.getElementById("reminderPetId");
  if (!select) return;
  select.innerHTML = (state.data?.pets || [])
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  // Set default reminder time to tomorrow 09:00
  const rt = document.getElementById("reminderTime");
  if (rt && !rt.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    rt.value = formatDateTimeLocal(tomorrow.toISOString());
  }
  // Update count badge
  const visible = visibleReminderTasks(state.data?.reminders || []);
  const pending = visible.filter((item) => reminderStatus(item) === "pending").length;
  const overdue = visible.filter((item) => reminderStatus(item) === "overdue").length;
  document.getElementById("reminderCount").textContent = `${pending} 待处理 / ${overdue} 已过期`;
}

function renderReminders() {
  const list = document.getElementById("reminderList");
  if (!list) return;
  const reminders = visibleReminderTasks(state.data.reminders || []);
  list.innerHTML = reminders.length
    ? reminders.map(reminderItem).join("")
    : `<div class="empty">暂无待处理提醒任务</div>`;
}

function visibleReminderTasks(items) {
  return sortRemindersByTime(items.filter((item) => item.status !== "done"));
}

async function handleReminderSubmit(event) {
  event.preventDefault();
  const btn = event.currentTarget.querySelector("button[type=submit]");
  setLoading(btn, true);
  try {
    const payload = {
      title: document.getElementById("reminderTitle").value.trim(),
      pet_id: document.getElementById("reminderPetId").value,
      reminder_time: document.getElementById("reminderTime").value,
    };
    const result = await api("/api/reminders", { method: "POST", body: JSON.stringify(payload) });
    state.data = result.state;
    renderAll();
    event.currentTarget.reset();
    populateReminderPetSelect();
    showToast("提醒已创建", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

async function completeReminder(id) {
  try {
    const result = await api(`/api/reminders/${id}/complete`, { method: "POST", body: JSON.stringify({}) });
    state.data = result.state;
    renderAll();
    showToast("已标记完成", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function deleteReminder(id) {
  const reminder = state.data?.reminders?.find((item) => item.id === id);
  const ok = await showConfirm({
    title: "删除提醒",
    message: reminder
      ? `确定删除“${reminder.title}”吗？删除后无法恢复。`
      : "确定删除这条提醒吗？删除后无法恢复。",
    okText: "删除提醒",
  });
  if (!ok) return;
  try {
    const result = await api(`/api/reminders/${id}`, { method: "DELETE" });
    state.data = result.state;
    renderAll();
    showToast("提醒已删除", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ===== Recommend =====

async function handleRecommend(event) {
  event.preventDefault();
  const btn = document.getElementById("recommendBtn");
  setLoading(btn, true, "生成中…");
  try {
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/recommend", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("recommendSource").textContent =
      result._source === "llm" ? "LLM" : "规则引擎";
    document.getElementById("recommendResult").innerHTML = result.recommendations
      .map((item) => `
        <article class="result-card">
          <div class="item-head">
            <h4>${escapeHtml(item.name)}</h4>
            <span class="badge">${item.score} 分</span>
          </div>
          <p>${escapeHtml(item.reason)}</p>
          <p class="care-plan">📋 ${escapeHtml(item.care_plan)}</p>
        </article>`).join("");
    if (result.input_summary) {
      document.getElementById("recommendResult").innerHTML +=
        `<p class="recommend-note">💡 ${escapeHtml(result.llm_note)}</p>`;
    }
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

// ===== Cloud =====

function renderCloud() {
  const labels = {
    ecs:            "ECS 云服务器",
    database:       "业务数据库",
    object_storage: "对象存储 OBS",
    llm:            "LLM 解析服务",
    worker:         "异步 Worker",
  };
  document.getElementById("cloudStatus").innerHTML = Object.entries(state.data.cloud)
    .map(([key, value]) => `
      <article class="cloud-node">
        <strong>${labels[key] || key}</strong>
        <span>${escapeHtml(value)}</span>
      </article>`).join("");
}

// ===== LLM Config Modal =====

function openLlmModal() {
  document.getElementById("llmModal").classList.remove("hidden");
  document.getElementById("llmTestResult").classList.add("hidden");
}

function closeLlmModal() {
  document.getElementById("llmModal").classList.add("hidden");
}

async function saveLlmConfig() {
  const btn = document.getElementById("llmSaveBtn");
  setLoading(btn, true, "保存中…");
  const testEl = document.getElementById("llmTestResult");
  testEl.classList.remove("hidden");
  testEl.textContent = "正在连接…";
  testEl.className = "llm-test-result";
  try {
    const payload = {
      api_key:  document.getElementById("llmApiKey").value.trim(),
      base_url: document.getElementById("llmBaseUrl").value.trim() || "https://api.openai.com/v1",
      model:    document.getElementById("llmModel").value.trim() || "gpt-4o-mini",
    };
    const result = await api("/api/llm/config", { method: "POST", body: JSON.stringify(payload) });
    testEl.textContent = result.connected
      ? `✅ 配置成功，模型：${result.model}`
      : result.available
        ? `⚠️ 已保存，但模型连通性测试失败：${result.error || "未知错误"}`
        : "⚠️ API Key 为空，将使用规则引擎";
    testEl.className = "llm-test-result " + (result.connected ? "ok" : "warn");
    // Refresh state so LLM status badge updates
    await loadState();
    showToast("LLM 配置已保存", "success");
  } catch (err) {
    testEl.textContent = "❌ 保存失败：" + err.message;
    testEl.className = "llm-test-result error";
  } finally {
    setLoading(btn, false);
  }
}

// ===== Login =====

function enterApp(user, stateData) {
  state.user = user;
  state.data = stateData;
  state.allLogs = [...(stateData.logs || [])];
  localStorage.setItem("petcare_user", JSON.stringify(user));
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  setView("dashboard");
  renderAll();
}

async function handleLogin(event) {
  event.preventDefault();
  const btn = event.currentTarget.querySelector("button[type=submit]");
  setLoading(btn, true, "登录中…");
  try {
    const payload = {
      username: document.getElementById("loginUsername").value,
      password: document.getElementById("loginPassword").value,
    };
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    enterApp(result.user, result.state);
  } catch (err) {
    showToast("登录失败：" + err.message, "error");
  } finally {
    setLoading(btn, false);
  }
}

// Auto-login if session persisted
(async () => {
  const saved = localStorage.getItem("petcare_user");
  if (saved) {
    try {
      const user = JSON.parse(saved);
      const stateData = await api("/api/state");
      enterApp(user, stateData);
    } catch {
      localStorage.removeItem("petcare_user");
    }
  }
})();

// ===== Upload Avatar =====

async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
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
      state.allLogs = [...(state.data.logs || [])];
      renderAll();
      showToast("头像已更新", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };
  reader.readAsDataURL(file);
}

// ===== Event binding =====

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("petForm").addEventListener("submit", handlePetSubmit);
  document.getElementById("petCancelBtn").addEventListener("click", cancelEditPet);
  document.getElementById("chatForm").addEventListener("submit", handleChatSubmit);
  document.getElementById("recommendForm").addEventListener("submit", handleRecommend);
  document.getElementById("reminderForm").addEventListener("submit", handleReminderSubmit);
  document.getElementById("refreshBtn").addEventListener("click", loadState);
  document.getElementById("quickChatBtn").addEventListener("click", () => setView("chat"));
  document.getElementById("voiceBtn").addEventListener("click", startVoice);

  // LLM modal
  document.getElementById("llmConfigBtn").addEventListener("click", openLlmModal);
  document.getElementById("llmModalClose").addEventListener("click", closeLlmModal);
  document.getElementById("llmModalClose2").addEventListener("click", closeLlmModal);
  document.getElementById("llmSaveBtn").addEventListener("click", saveLlmConfig);
  document.getElementById("llmModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLlmModal();
  });

  // Confirm modal
  document.getElementById("confirmClose").addEventListener("click", () => closeConfirm(false));
  document.getElementById("confirmCancel").addEventListener("click", () => closeConfirm(false));
  document.getElementById("confirmOk").addEventListener("click", () => closeConfirm(true));
  document.getElementById("confirmModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeConfirm(false);
  });

  // Navigation
  document.querySelectorAll(".nav-item").forEach((btn) =>
    btn.addEventListener("click", () => setView(btn.dataset.view))
  );

  // Log filters
  document.getElementById("logPetFilter").addEventListener("change", renderLogsFiltered);
  document.getElementById("logTypeFilter").addEventListener("change", renderLogsFiltered);

  // Delegated events (dynamically rendered content)
  document.body.addEventListener("click", async (e) => {
    const sample = e.target.closest("[data-sample]");
    if (sample) { await sendChat(sample.dataset.sample); return; }

    const dashboardFilter = e.target.closest("[data-dashboard-reminder-filter]");
    if (dashboardFilter) {
      state.dashboardReminderFilter = dashboardFilter.dataset.dashboardReminderFilter;
      renderDashboard();
      return;
    }

    const complete = e.target.closest(".complete-reminder");
    if (complete) { await completeReminder(complete.dataset.id); return; }

    const delRem = e.target.closest(".delete-reminder");
    if (delRem) { await deleteReminder(delRem.dataset.id); return; }

    const sumPet = e.target.closest(".summarize-pet");
    if (sumPet) { await showPetSummary(sumPet.dataset.id); return; }

    const editPet = e.target.closest(".edit-pet");
    if (editPet) { setView("pets"); await startEditPet(editPet.dataset.id); return; }

    const delPet = e.target.closest(".delete-pet");
    if (delPet) { await deletePet(delPet.dataset.id); return; }
  });

  document.body.addEventListener("change", async (e) => {
    if (e.target.matches(".avatar-input")) await uploadAvatar(e.target);
  });
}

bindEvents();
