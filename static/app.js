const state = {
  user: null,
  data: null,
  view: "dashboard",
  allLogs: [],
  dashboardReminderFilter: "pending",
};

const viewTitles = {
  dashboard: ["PetCare Cloud", "首页待办"],
  pets: ["Pet Profile", "宠物档案"],
  chat: ["Smart Assistant", "智能助手"],
  logs: ["HealthLog", "健康日志"],
  reminders: ["Reminder", "提醒管理"],
  recommend: ["Pet Match", "养宠推荐"],
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
  low: "低风险",
  medium: "需观察",
  high: "高风险",
};

const speciesLabel = {
  猫: "CAT",
  狗: "DOG",
  鸟: "BIR",
  小型动物: "PET",
  爬行动物: "REP",
  兔子: "BUN",
  仓鼠: "HAM",
  龙猫: "CHI",
  鹦鹉: "BIR",
  鱼: "FISH",
  乌龟: "TUR",
};

const petSetup = {
  step: 1,
  mode: "create",
  photo: null,
};

let voiceRecognition = null;
let voiceStopRequested = false;
let voiceBaseText = "";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
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

function formatDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function petName(id) {
  return state.data?.pets.find((pet) => pet.id === id)?.name || "未知宠物";
}

function petMark(pet) {
  return speciesLabel[pet?.species] || "PET";
}

function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

function setLoading(button, loading, text) {
  if (!button) return;
  button.disabled = loading;
  if (loading) {
    button._originalText = button.textContent;
    button.textContent = text || "处理中...";
  } else {
    button.textContent = button._originalText || button.textContent;
  }
}

function normalizeMessage(message) {
  let parsed = message.parsed_result || {};
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  return { ...message, parsed_result: parsed };
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  const [eyebrow, title] = viewTitles[view] || ["", view];
  document.getElementById("viewEyebrow").textContent = eyebrow;
  document.getElementById("viewTitle").textContent = title;
  if (view === "logs") renderLogsFiltered();
  if (view === "reminders") populateReminderPetSelect();
}

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
  renderChat();
  renderLogs();
  renderReminders();
  renderCloud();
  populateLogFilters();
  populateReminderPetSelect();
  document.getElementById("assistantFab").classList.remove("hidden");
}

function updateLlmStatus() {
  const dot = document.getElementById("llmDot");
  const label = document.getElementById("parserMode");
  if (state.data?.llm_connected) {
    dot.className = "llm-dot online";
    label.textContent = "LLM 已接入";
    return;
  }
  if (state.data?.llm_available) {
    dot.className = "llm-dot warn";
    label.textContent = "LLM 待检查";
    return;
  }
  dot.className = "llm-dot offline";
  label.textContent = "规则解析兜底";
}

function renderMetrics() {
  const stats = state.data.stats || {};
  const metrics = [
    ["宠物数量", stats.pet_count || 0, "已建档案"],
    ["今日待办", stats.pending_today || 0, "需要处理"],
    ["日志总数", stats.log_count || 0, "护理记录"],
    ["异常记录", stats.abnormal_count || 0, "重点观察"],
  ];
  document.getElementById("metricGrid").innerHTML = metrics
    .map(([label, value, hint]) => `
      <article class="metric">
        <span>${label}</span>
        <strong>${value}</strong>
        <em>${hint}</em>
      </article>
    `)
    .join("");
}

function renderDashboard() {
  const reminders = sortRemindersByTime(state.data.reminders || []);
  const buckets = {
    pending: reminders.filter((item) => reminderStatus(item) === "pending"),
    overdue: reminders.filter((item) => reminderStatus(item) === "overdue"),
    done: reminders.filter((item) => reminderStatus(item) === "done"),
  };
  const labels = {
    pending: "待处理",
    overdue: "已过期",
    done: "已完成",
  };
  if (!labels[state.dashboardReminderFilter]) state.dashboardReminderFilter = "pending";
  const activeItems = buckets[state.dashboardReminderFilter].slice(0, 6);
  document.getElementById("pendingCount").textContent =
    `${buckets.pending.length} 待处理 / ${buckets.overdue.length} 已过期 / ${buckets.done.length} 已完成`;
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
          </button>
        `).join("")}
      </div>
      <div class="list">
        ${activeItems.length ? activeItems.map(reminderItem).join("") : `<div class="empty small">暂无${labels[state.dashboardReminderFilter]}提醒</div>`}
      </div>
    `
    : `<div class="empty">今天没有待办，可以放心休息一下。</div>`;

  const logs = (state.data.logs || []).slice(0, 7);
  document.getElementById("dashboardLogs").innerHTML = logs.length
    ? logs.map(logTimelineItem).join("")
    : `<div class="empty">还没有健康日志，找小护记录一条吧。</div>`;
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
    <article class="reminder-card ${done ? "done" : ""} ${overdue ? "overdue" : ""}">
      <div class="reminder-icon">${done ? "✓" : "!"}</div>
      <div class="reminder-content">
        <div class="item-head">
          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(petName(item.pet_id))} · ${formatDateTime(item.reminder_time)}
            ${overdue ? '<span class="overdue-badge">逾期</span>' : ""}</p>
          </div>
          <span class="badge ${done ? "done" : ""} ${overdue ? "overdue" : ""}">${badgeText}</span>
        </div>
        <div class="item-actions">
          ${!done ? `<button class="ghost-action small complete-reminder" data-id="${item.id}">完成</button>` : ""}
          <button class="ghost-action small danger delete-reminder" data-id="${item.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function logTimelineItem(item) {
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
  const pets = state.data.pets || [];
  const addCard = `
    <button class="add-pet-card" id="addPetCard" aria-label="新增宠物档案">
      <span class="add-pet-plus">+</span>
      <span class="add-pet-text">添加宠物档案</span>
    </button>
  `;

  const petCards = pets
    .map((pet) => {
      const avatar = pet.avatar_url
        ? `<img class="pet-profile-photo" src="${pet.avatar_url}" alt="${escapeHtml(pet.name)}" />`
        : `<div class="pet-profile-photo text-avatar">${escapeHtml(petMark(pet))}</div>`;
      return `
        <article class="pet-card pet-profile-card">
          <div class="pet-photo-wrap">
            ${avatar}
            <label class="pet-photo-action" title="上传头像">
              <span>相机</span>
              <input type="file" accept="image/*" class="avatar-input" data-id="${pet.id}" />
            </label>
          </div>
          <div class="pet-card-body">
            <h4>${escapeHtml(pet.name)}</h4>
            <div class="pet-species-pill">${escapeHtml(pet.species)}${pet.breed ? " · " + escapeHtml(pet.breed) : ""}</div>
            <div class="pet-profile-fields">
              <div>
                <span>生日</span>
                <strong>${escapeHtml(pet.birthday || "未填写")}</strong>
              </div>
              <div>
                <span>体重</span>
                <strong>${pet.weight ? `${pet.weight} kg` : "-"}</strong>
              </div>
            </div>
            <p>${escapeHtml(pet.notes || "暂无照护备注")}</p>
          </div>
          <div class="item-actions pet-actions">
            <button class="ghost-action small summarize-pet" data-id="${pet.id}">健康小结</button>
            <button class="ghost-action small edit-pet" data-id="${pet.id}">编辑</button>
            <button class="ghost-action small danger delete-pet" data-id="${pet.id}">删除</button>
          </div>
        </article>
      `;
    })
    .join("");

  grid.innerHTML = `${petCards}${addCard}`;
}

function renderChat() {
  const messages = (state.data.messages || []).map(normalizeMessage).slice(0, 8);
  const history = document.getElementById("chatHistory");
  history.innerHTML = messages.length
    ? messages
        .map((message) => `
          <article class="history-card">
            <p class="history-user">${escapeHtml(message.raw_content)}</p>
            <p class="history-reply">${escapeHtml(message.parsed_result.reply || "已记录")}</p>
          </article>
        `)
        .join("")
    : `<div class="empty">还没有聊天记录，点击“小护”开始记录。</div>`;

  renderAssistantStream();
}

function renderAssistantStream() {
  const stream = document.getElementById("assistantStream");
  const messages = (state.data?.messages || []).map(normalizeMessage).slice().reverse();
  if (!messages.length) {
    stream.innerHTML = `
      <div class="assistant-welcome">
        <span class="pet-head-icon"></span>
        <p>你好，我是小护。你可以直接告诉我宠物日常、症状、喂药或疫苗安排。</p>
      </div>
    `;
    return;
  }
  stream.innerHTML = messages
    .map((message, index) => `
      <div class="bubble user" id="msg-${index}">${escapeHtml(message.raw_content)}</div>
      <div class="bubble ai">${escapeHtml(message.parsed_result.reply || "已记录")}</div>
    `)
    .join("");
  stream.scrollTop = stream.scrollHeight;
}

function populateLogFilters() {
  const select = document.getElementById("logPetFilter");
  const current = select.value;
  select.innerHTML = `<option value="">全部宠物</option>` + (state.data.pets || [])
    .map((pet) => `<option value="${pet.id}">${escapeHtml(pet.name)}</option>`)
    .join("");
  select.value = current;
}

function renderLogs() {
  renderLogsFiltered();
}

function renderLogsFiltered() {
  const petId = document.getElementById("logPetFilter").value;
  const type = document.getElementById("logTypeFilter").value;
  const logs = state.allLogs.filter((log) => {
    return (!petId || log.pet_id === petId) && (!type || log.record_type === type);
  });
  document.getElementById("logTable").innerHTML = logs.length
    ? logs
        .map((log) => {
          const severity = log.severity || "low";
          return `
            <tr>
              <td>${escapeHtml(log.date)}</td>
              <td>${escapeHtml(petName(log.pet_id))}</td>
              <td>${recordLabels[log.record_type] || escapeHtml(log.record_type)}</td>
              <td><span class="badge ${severity}">${severityLabels[severity] || severity}</span></td>
              <td>${escapeHtml(log.summary)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5"><div class="empty">没有匹配的日志。</div></td></tr>`;
}

function populateReminderPetSelect() {
  const select = document.getElementById("reminderPetId");
  if (!select) return;
  const current = select.value;
  select.innerHTML = (state.data.pets || [])
    .map((pet) => `<option value="${pet.id}">${escapeHtml(pet.name)}</option>`)
    .join("");
  select.value = current || select.options[0]?.value || "";

  const reminderTimeInput = document.getElementById("reminderTime");
  if (reminderTimeInput && !reminderTimeInput.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    reminderTimeInput.value = formatDateTimeLocal(tomorrow.toISOString());
  }
}

function renderReminders() {
  const reminders = visibleReminderTasks(state.data.reminders || []);
  const pending = reminders.filter((item) => reminderStatus(item) === "pending").length;
  const overdue = reminders.filter((item) => reminderStatus(item) === "overdue").length;
  document.getElementById("reminderCount").textContent = `${pending} 待处理 / ${overdue} 已过期`;
  document.getElementById("reminderList").innerHTML = reminders.length
    ? reminders.map(reminderItem).join("")
    : `<div class="empty">暂无待处理提醒任务。</div>`;
}

function visibleReminderTasks(items) {
  return sortRemindersByTime(items.filter((item) => item.status !== "done"));
}

function renderCloud() {
  const labels = {
    ecs: "ECS 云服务器",
    database: "业务数据库",
    object_storage: "对象存储 OBS",
    llm: "LLM 解析服务",
    worker: "异步 Worker",
  };
  document.getElementById("cloudStatus").innerHTML = Object.entries(state.data.cloud || {})
    .map(([key, value]) => `
      <article class="cloud-node">
        <strong>${labels[key] || key}</strong>
        <span>${escapeHtml(value)}</span>
      </article>
    `)
    .join("");
}

function openAssistant() {
  document.getElementById("assistantModal").classList.remove("hidden");
  document.getElementById("assistantInput").focus();
  renderAssistantStream();
}

function closeAssistant() {
  document.getElementById("assistantModal").classList.add("hidden");
}

async function sendChat(content) {
  const result = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ content, input_type: "text" }),
  });
  state.data = result.state;
  state.allLogs = [...(state.data.logs || [])];
  renderAll();
  return result.parsed;
}

async function handleAssistantSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("assistantInput");
  const content = input.value.trim();
  if (!content) {
    showToast("请输入记录内容", "error");
    return;
  }
  const button = document.getElementById("assistantSendBtn");
  setLoading(button, true, "记录中...");
  try {
    input.value = "";
    const parsed = await sendChat(content);
    showToast(parsed?.reply || "已记录", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(button, false);
  }
}

function resetAssistantVoiceButton() {
  const button = document.getElementById("assistantVoiceBtn");
  button.classList.remove("listening");
  button.title = "语音输入";
}

function stopAssistantVoice() {
  if (!voiceRecognition) return;
  voiceStopRequested = true;
  const button = document.getElementById("assistantVoiceBtn");
  button.title = "正在停止语音输入";
  try {
    voiceRecognition.stop();
  } catch {
    voiceRecognition.abort();
  }
}

function startAssistantVoice() {
  if (voiceRecognition) {
    stopAssistantVoice();
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = document.getElementById("assistantVoiceBtn");
  const input = document.getElementById("assistantInput");

  if (!Recognition) {
    showToast("当前浏览器不支持语音输入（建议使用 Chrome / Edge）", "error");
    return;
  }

  const recognition = new Recognition();
  voiceRecognition = recognition;
  voiceStopRequested = false;
  voiceBaseText = input.value.trim();

  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    button.classList.add("listening");
    button.title = "点击停止语音输入";
    showToast("正在听写，再点一次麦克风可停止。", "success");
  };

  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = 0; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    const spokenText = `${finalText}${interimText}`.trim();
    input.value = [voiceBaseText, spokenText].filter(Boolean).join(" ");
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted" && voiceStopRequested) return;
    const label =
      event.error === "not-allowed"
        ? "浏览器没有麦克风权限。"
        : event.error === "no-speech"
          ? "没有识别到语音，请靠近麦克风再试。"
          : `语音识别失败：${event.error}`;
    showToast(label, "error");
  };

  recognition.onend = () => {
    if (voiceRecognition === recognition) {
      voiceRecognition = null;
      voiceStopRequested = false;
      voiceBaseText = "";
      resetAssistantVoiceButton();
      if (input.value.trim()) {
        input.focus();
        showToast("语音内容已填入，确认后点击发送。", "success");
      }
    }
  };

  try {
    recognition.start();
  } catch (err) {
    voiceRecognition = null;
    voiceStopRequested = false;
    voiceBaseText = "";
    resetAssistantVoiceButton();
    showToast("语音识别启动失败：" + err.message, "error");
  }
}

function openPetModal(pet = null) {
  const form = document.getElementById("petForm");
  form.reset();
  clearPetPhoto();
  petSetup.mode = pet ? "edit" : "create";
  document.getElementById("editingPetId").value = pet?.id || "";
  document.getElementById("petSubmitBtn").textContent = pet ? "保存修改" : "完成建档";
  if (pet) {
    document.getElementById("petName").value = pet.name || "";
    selectSpecies(pet.species || "猫");
    document.getElementById("petBreed").value = pet.breed || "";
    document.getElementById("petBirthday").value = pet.birthday || "";
    document.getElementById("petWeight").value = pet.weight || "";
    document.getElementById("petNotes").value = pet.notes || "";
  } else {
    selectSpecies("狗");
  }
  document.getElementById("petModal").classList.remove("hidden");
  setPetStep(pet ? 2 : 1);
  setTimeout(() => {
    if (pet) document.getElementById("petName").focus();
  }, 50);
}

function closePetModal() {
  document.getElementById("petModal").classList.add("hidden");
}

function setPetStep(step) {
  petSetup.step = Math.max(1, Math.min(3, step));
  document.querySelectorAll(".setup-step").forEach((section) => {
    section.classList.toggle("active", Number(section.dataset.step) === petSetup.step);
  });
  document.querySelectorAll(".step-dot").forEach((dot) => {
    const dotStep = Number(dot.dataset.dot);
    dot.classList.toggle("active", dotStep === petSetup.step);
    dot.classList.toggle("done", dotStep < petSetup.step);
  });
  document.getElementById("petStepBack").classList.toggle("invisible", petSetup.step === 1);
}

function selectSpecies(species) {
  document.getElementById("petSpecies").value = species;
  document.querySelectorAll(".species-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.species === species);
  });
}

function clearPetPhoto() {
  petSetup.photo = null;
  const preview = document.getElementById("petPhotoPreview");
  preview.style.backgroundImage = "";
  preview.classList.remove("has-photo");
  preview.innerHTML = `<span class="camera-icon"></span><small>点击上传</small>`;
  document.getElementById("petPhotoInput").value = "";
}

function handlePetPhoto(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    petSetup.photo = {
      data_url: reader.result,
      filename: file.name,
      mime: file.type || "image/jpeg",
    };
    const preview = document.getElementById("petPhotoPreview");
    preview.classList.add("has-photo");
    preview.style.backgroundImage = `url("${reader.result}")`;
    preview.innerHTML = `<small>重新上传</small>`;
  };
  reader.readAsDataURL(file);
}

async function uploadSetupPhoto(petId) {
  if (!petSetup.photo || !petId) return null;
  return api("/api/upload", {
    method: "POST",
    body: JSON.stringify({
      pet_id: petId,
      filename: petSetup.photo.filename,
      mime: petSetup.photo.mime,
      data_url: petSetup.photo.data_url,
    }),
  });
}

function validatePetAbout() {
  const name = document.getElementById("petName").value.trim();
  if (!name) {
    showToast("请先填写宠物名字", "error");
    document.getElementById("petName").focus();
    return false;
  }
  return true;
}

async function handlePetSubmit(event) {
  event.preventDefault();
  const button = document.getElementById("petSubmitBtn");
  setLoading(button, true, "保存中...");
  try {
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const id = document.getElementById("editingPetId").value;
    const result = await api(id ? `/api/pets/${id}` : "/api/pets", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    let nextState = result.state;
    const petId = id || result.pet?.id;
    const uploadResult = await uploadSetupPhoto(petId);
    if (uploadResult?.state) nextState = uploadResult.state;
    state.data = nextState;
    state.allLogs = [...(state.data.logs || [])];
    closePetModal();
    renderAll();
    showToast(id ? "宠物档案已更新" : "宠物档案已新增", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(button, false);
  }
}

async function deletePet(id) {
  if (!confirm("确定删除这只宠物吗？相关日志和提醒也会删除。")) return;
  try {
    const result = await api(`/api/pets/${id}`, { method: "DELETE" });
    state.data = result.state;
    state.allLogs = [...(state.data.logs || [])];
    renderAll();
    showToast("宠物档案已删除", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function showPetSummary(id) {
  try {
    const result = await api(`/api/pets/${id}/summarize`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    alert(result.summary || "暂无健康小结");
  } catch (err) {
    showToast(err.message, "error");
  }
}

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

async function handleReminderSubmit(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  setLoading(button, true, "创建中...");
  try {
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/reminders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.data = result.state;
    event.currentTarget.reset();
    renderAll();
    showToast("提醒已创建", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(button, false);
  }
}

async function completeReminder(id) {
  try {
    const result = await api(`/api/reminders/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.data = result.state;
    renderAll();
    showToast("已标记完成", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function deleteReminder(id) {
  const reminder = state.data?.reminders?.find((item) => item.id === id);
  const message = reminder ? `确定删除“${reminder.title}”吗？删除后无法恢复。` : "确定删除这条提醒吗？删除后无法恢复。";
  if (!confirm(message)) return;
  try {
    const result = await api(`/api/reminders/${id}`, { method: "DELETE" });
    state.data = result.state;
    renderAll();
    showToast("提醒已删除", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleRecommend(event) {
  event.preventDefault();
  const button = document.getElementById("recommendBtn");
  setLoading(button, true, "生成中...");
  try {
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const result = await api("/api/recommend", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    document.getElementById("recommendSource").textContent = result._source === "llm" ? "LLM" : "规则推荐";
    document.getElementById("recommendResult").innerHTML = (result.recommendations || [])
      .map((item, index) => `
        <article class="match-card">
          <div class="match-rank">${index + 1}</div>
          <div class="match-body">
            <div class="item-head">
              <h4>${escapeHtml(item.name)}</h4>
              <span class="match-score">${item.score} 分</span>
            </div>
            <p>${escapeHtml(item.reason)}</p>
            <p class="care-plan">${escapeHtml(item.care_plan)}</p>
          </div>
        </article>
      `)
      .join("");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(button, false);
  }
}

function openLlmModal() {
  document.getElementById("llmModal").classList.remove("hidden");
  document.getElementById("llmTestResult").classList.add("hidden");
}

function closeLlmModal() {
  document.getElementById("llmModal").classList.add("hidden");
}

async function saveLlmConfig() {
  const button = document.getElementById("llmSaveBtn");
  const resultBox = document.getElementById("llmTestResult");
  setLoading(button, true, "测试中...");
  resultBox.classList.remove("hidden");
  resultBox.textContent = "正在连接模型...";
  resultBox.className = "llm-test-result";
  try {
    const result = await api("/api/llm/config", {
      method: "POST",
      body: JSON.stringify({
        api_key: document.getElementById("llmApiKey").value.trim(),
        base_url: document.getElementById("llmBaseUrl").value.trim() || "https://api.openai.com/v1",
        model: document.getElementById("llmModel").value.trim() || "gpt-4o-mini",
      }),
    });
    resultBox.textContent = result.connected
      ? `配置成功，模型：${result.model}`
      : result.available
        ? `已保存，但连接测试失败：${result.error || "未知错误"}`
        : "API Key 为空，将继续使用规则解析。";
    resultBox.className = `llm-test-result ${result.connected ? "ok" : "warn"}`;
    await loadState();
  } catch (err) {
    resultBox.textContent = `保存失败：${err.message}`;
    resultBox.className = "llm-test-result error";
  } finally {
    setLoading(button, false);
  }
}

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
  const button = event.currentTarget.querySelector("button[type=submit]");
  setLoading(button, true, "登录中...");
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("loginUsername").value,
        password: document.getElementById("loginPassword").value,
      }),
    });
    enterApp(result.user, result.state);
  } catch (err) {
    showToast(`登录失败：${err.message}`, "error");
  } finally {
    setLoading(button, false);
  }
}

async function autoLogin() {
  const saved = localStorage.getItem("petcare_user");
  if (!saved) return;
  try {
    const user = JSON.parse(saved);
    const data = await api("/api/state");
    enterApp(user, data);
  } catch {
    localStorage.removeItem("petcare_user");
  }
}

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("refreshBtn").addEventListener("click", loadState);
  document.getElementById("quickChatBtn").addEventListener("click", openAssistant);
  document.getElementById("heroAssistantBtn").addEventListener("click", openAssistant);
  document.getElementById("openAssistantBtn").addEventListener("click", openAssistant);
  document.getElementById("assistantFab").addEventListener("click", openAssistant);
  document.getElementById("assistantCloseBtn").addEventListener("click", closeAssistant);
  document.getElementById("assistantForm").addEventListener("submit", handleAssistantSubmit);
  document.getElementById("assistantVoiceBtn").addEventListener("click", startAssistantVoice);

  document.getElementById("petModalCloseBtn").addEventListener("click", closePetModal);
  document.getElementById("petCancelBtn").addEventListener("click", closePetModal);
  document.getElementById("petForm").addEventListener("submit", handlePetSubmit);
  document.getElementById("petStepBack").addEventListener("click", () => setPetStep(petSetup.step - 1));
  document.getElementById("petNextPhoto").addEventListener("click", () => setPetStep(2));
  document.getElementById("petNextAbout").addEventListener("click", () => {
    if (validatePetAbout()) setPetStep(3);
  });
  document.getElementById("petPhotoInput").addEventListener("change", (event) => {
    handlePetPhoto(event.target.files?.[0]);
  });
  document.querySelectorAll(".species-chip").forEach((button) => {
    button.addEventListener("click", () => selectSpecies(button.dataset.species));
  });

  document.getElementById("reminderForm").addEventListener("submit", handleReminderSubmit);
  document.getElementById("recommendForm").addEventListener("submit", handleRecommend);
  document.getElementById("llmConfigBtn").addEventListener("click", openLlmModal);
  document.getElementById("llmModalClose").addEventListener("click", closeLlmModal);
  document.getElementById("llmModalClose2").addEventListener("click", closeLlmModal);
  document.getElementById("llmSaveBtn").addEventListener("click", saveLlmConfig);

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  document.getElementById("logPetFilter").addEventListener("change", renderLogsFiltered);
  document.getElementById("logTypeFilter").addEventListener("change", renderLogsFiltered);

  document.body.addEventListener("click", async (event) => {
    if (event.target === document.getElementById("assistantModal")) closeAssistant();
    if (event.target === document.getElementById("petModal")) closePetModal();
    if (event.target === document.getElementById("llmModal")) closeLlmModal();

    const sample = event.target.closest("[data-sample]");
    if (sample) {
      document.getElementById("assistantInput").value = sample.dataset.sample;
      openAssistant();
      return;
    }

    const dashboardFilter = event.target.closest("[data-dashboard-reminder-filter]");
    if (dashboardFilter) {
      state.dashboardReminderFilter = dashboardFilter.dataset.dashboardReminderFilter;
      renderDashboard();
      return;
    }

    const addPetCard = event.target.closest("#addPetCard");
    if (addPetCard) {
      openPetModal();
      return;
    }

    const complete = event.target.closest(".complete-reminder");
    if (complete) {
      await completeReminder(complete.dataset.id);
      return;
    }

    const deleteRem = event.target.closest(".delete-reminder");
    if (deleteRem) {
      await deleteReminder(deleteRem.dataset.id);
      return;
    }

    const summarize = event.target.closest(".summarize-pet");
    if (summarize) {
      await showPetSummary(summarize.dataset.id);
      return;
    }

    const edit = event.target.closest(".edit-pet");
    if (edit) {
      const pet = state.data.pets.find((item) => item.id === edit.dataset.id);
      openPetModal(pet);
      return;
    }

    const deleteButton = event.target.closest(".delete-pet");
    if (deleteButton) {
      await deletePet(deleteButton.dataset.id);
    }
  });

  document.body.addEventListener("change", async (event) => {
    if (event.target.matches(".avatar-input")) await uploadAvatar(event.target);
  });
}

bindEvents();
autoLogin();
