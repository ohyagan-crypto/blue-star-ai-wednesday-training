const DEFAULT_API_BASE = location.hostname.endsWith("loca.lt") ? location.origin : "https://solely-sleeve-furthermore-ons.trycloudflare.com";
let activeApiBase = DEFAULT_API_BASE;
let apiBases = [DEFAULT_API_BASE];
const sessions = ["8/19 剪映 & 數字人實戰班","8/26 即夢 Seedance AI 網紅基礎班","9/2 AI 龍蝦智能體趨勢班"];
const sessionCapacities = {
  "8/19 剪映 & 數字人實戰班": 30,
  "8/26 即夢 Seedance AI 網紅基礎班": 30,
  "9/2 AI 龍蝦智能體趨勢班": 30
};
const sessionInfo = {
  "8/19 剪映 & 數字人實戰班": { title: "8/19（三）剪映 & 數字人實戰班", address: "台中市西屯路二段256巷6號16樓之2｜藍星 AI 辦公室", transit: "14:00-16:00｜捷運文心櫻花站｜停車：逢甲立體停車場" },
  "8/26 即夢 Seedance AI 網紅基礎班": { title: "8/26（三）即夢 Seedance AI 網紅基礎班", address: "台中市西屯路二段256巷6號16樓之2｜藍星 AI 辦公室", transit: "14:00-16:00｜捷運文心櫻花站｜停車：逢甲立體停車場" },
  "9/2 AI 龍蝦智能體趨勢班": { title: "9/2（三）AI 龍蝦智能體趨勢班", address: "台中市西屯路二段256巷6號16樓之2｜藍星 AI 辦公室", transit: "14:00-16:00｜捷運文心櫻花站｜停車：逢甲立體停車場" }
};
const SCRIPT_VERSION = "20260805223000";
const REGISTRATION_CLOSED = true;
const PIN_STORAGE_KEY = "blueCourseStaffPin";
const CHECKIN_STATS_COLLAPSED_KEY = "blueCourseCheckinStatsCollapsed";

let lastVoice = "";
let voiceUnlocked = false;
let rosterData = { registrations: [], checkins: [] };
let lastCheckin = null;
let checkinStatsExpanded = loadCheckinStatsExpanded();

function normalizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function loadApiConfig() {
  if (location.hostname.endsWith("loca.lt")) return;
  try {
    const res = await fetch(`./api-config.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("api config unavailable");
    const config = await res.json();
    const candidates = [
      config.publicBase,
      ...(Array.isArray(config.publicBases) ? config.publicBases : []),
      DEFAULT_API_BASE
    ].map(normalizeApiBase).filter(Boolean);
    apiBases = [...new Set(candidates)];
    activeApiBase = apiBases[0] || DEFAULT_API_BASE;
  } catch {
    apiBases = [DEFAULT_API_BASE];
    activeApiBase = DEFAULT_API_BASE;
  }
}

const apiConfigReady = loadApiConfig();

function api(path, base = activeApiBase) {
  return `${base}${path}`;
}

async function fetchWithApiFallback(path, options = {}) {
  await apiConfigReady;
  let lastError = null;
  for (const base of apiBases) {
    try {
      const res = await fetch(api(path, base), options);
      activeApiBase = base;
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = new Error(`API ${res.status}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("API unavailable");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function unlockVoice() {
  if (!window.speechSynthesis || voiceUnlocked) return;
  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.lang = "zh-TW";
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
  voiceUnlocked = true;
}

function fillSessionSelects() {
  const options = `<option value="">請選擇</option>${sessions.map((session) => `<option value="${session}">${session}</option>`).join("")}`;
  document.querySelectorAll('select[name="session"]').forEach((select) => {
    select.innerHTML = options;
  });

  document.getElementById("sessionList").innerHTML = sessions.map((session) => {
    const info = sessionInfo[session];
    const address = info.address ? `<span>${info.address}</span>` : "";
    return `<div><strong>${info.title}</strong>${address}<small>${info.transit}</small></div>`;
  }).join("");
}

function setView(id) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === id));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  if (id === "roster" || id === "checkin") loadRoster();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function updateIntroducerRequirement(form = document.getElementById("registerForm")) {
  const type = form?.elements.participantType?.value || "";
  const input = form?.elements.introducer;
  const label = document.getElementById("introducerLabel");
  if (!input || !label) return;
  const required = type === "新人";
  input.required = required;
  input.placeholder = required ? "新人必填，請填寫介紹人" : "複訓選填";
  label.firstChild.textContent = required ? "介紹人（新人必填）" : "介紹人（複訓選填）";
}

function setMessage(el, ok, text) {
  el.className = `message ${ok ? "ok" : "err"}`;
  el.textContent = text;
}

function showModal({ title, message = "", body = "", okIcon = true }) {
  const modal = document.getElementById("appModal");
  const card = modal?.querySelector(".modal-card");
  if (!modal || !card) return;
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalMessage").textContent = message;
  document.getElementById("modalBody").innerHTML = body;
  document.querySelector(".modal-ok").hidden = !okIcon;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  card.focus();
}

function closeModal() {
  const modal = document.getElementById("appModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function getActiveRegistrations(session) {
  return (rosterData.registrations || []).filter((item) => item.session === session && !isCanceled(item));
}

function getSessionCheckins(session) {
  return (rosterData.checkins || []).filter((item) => item.session === session);
}

function renderRegistrationList(session) {
  const regs = getActiveRegistrations(session);
  const checked = new Set(getSessionCheckins(session).map((item) => item.name));
  if (!regs.length) return `<p class="modal-empty">目前這個場次尚無有效報名資料。</p>`;
  return `
    <div class="modal-list">
      ${regs.map((reg, index) => {
        const name = escapeHtml(reg.name);
        const type = escapeHtml(reg.participantType || reg.type || "未填身分");
        const status = checked.has(reg.name) ? "已報到" : "未報到";
        const note = escapeHtml(reg.createdAt || reg.note || "");
        return `
          <article class="modal-person">
            <strong>${index + 1}. ${name}</strong>
            <span>${type} · ${status}</span>
            ${note ? `<small>${note}</small>` : ""}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

async function postJson(path, data) {
  let res;
  try {
    res = await fetchWithApiFallback(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch {
    throw new Error("送出失敗，請確認網路或後端服務是否正常。");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || "送出失敗，請稍後再試。");
  return body;
}

function speak(text) {
  lastVoice = text;
  if (!window.speechSynthesis) {
    alert(text);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  utterance.rate = 0.92;
  utterance.pitch = 1.05;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function checkinVoiceText(data) {
  return `${data.name} 報到成功`;
}

function isCanceled(reg) {
  return reg.status === "cancelled" || reg.cancelled === true || Boolean(reg.cancelledAt);
}

function getSessionCapacity(session) {
  return Number(rosterData?.capacityBySession?.[session] || sessionCapacities[session] || 0);
}

function getRemainingSeats(session, regs) {
  const capacity = getSessionCapacity(session);
  if (!capacity) return null;
  return Math.max(0, capacity - regs.length);
}

function getCheckedInCount(data, session, regs) {
  return (data.checkins || []).filter((item) => item.session === session).length;
}

function normalizeParticipantType(reg) {
  const type = String(reg?.participantType || reg?.type || "").trim();
  if (type.includes("新人")) return "新人";
  if (type.includes("複訓") || type.includes("復訓")) return "複訓";
  return "未填";
}

function getCheckedInBreakdown(data, session, regs) {
  const checks = (data.checkins || []).filter((item) => item.session === session);
  const activeRegByName = new Map(regs.map((reg) => [reg.name, reg]));
  return checks.reduce((summary, check) => {
    const type = normalizeParticipantType(activeRegByName.get(check.name));
    summary.total += 1;
    if (type === "新人") summary.newbie += 1;
    else if (type === "複訓") summary.returning += 1;
    else summary.unknown += 1;
    return summary;
  }, { total: 0, newbie: 0, returning: 0, unknown: 0 });
}

function formatCheckinBreakdown(breakdown) {
  const unknownText = breakdown.unknown ? `｜未填 ${breakdown.unknown} 人` : "";
  return `簽到 新人 ${breakdown.newbie} 人｜複訓 ${breakdown.returning} 人${unknownText}｜合計 ${breakdown.total} 人`;
}

function formatCityCheckinBreakdowns(sessionSummaries) {
  return `<div class="city-checkin-grid checkin-breakdown" aria-label="各城市簽到人數">${sessionSummaries.map((item) => {
    const breakdown = item.breakdown;
    const unknownText = breakdown.unknown ? `｜未填 ${breakdown.unknown} 人` : "";
    return `<span class="city-checkin-item"><strong>${escapeHtml(item.city)}</strong><small>新人 ${breakdown.newbie} 人｜複訓 ${breakdown.returning} 人${unknownText}｜合計 ${breakdown.total} 人</small></span>`;
  }).join("")}</div>`;
}

function getSessionCity(session) {
  return String(session || "").replace(/^\d+\/\d+\s*/, "").replace(/場$/, "");
}

function loadCheckinStatsExpanded() {
  try {
    return localStorage.getItem(CHECKIN_STATS_COLLAPSED_KEY) !== "1";
  } catch {
    return true;
  }
}

function saveCheckinStatsExpanded() {
  try {
    localStorage.setItem(CHECKIN_STATS_COLLAPSED_KEY, checkinStatsExpanded ? "0" : "1");
  } catch {
    // Browser storage may be unavailable in private or restricted modes.
  }
}

function syncCheckinStatsToggle() {
  const section = document.querySelector(".bottom-stats");
  const button = document.getElementById("toggleCheckinStats");
  if (!section) return;
  section.classList.toggle("checkin-stats-collapsed", !checkinStatsExpanded);
  if (!button) return;
  const action = button.querySelector(".stat-total-action");
  const actionText = checkinStatsExpanded ? "點一下收合明細" : "點一下展開明細";
  button.setAttribute("aria-expanded", String(checkinStatsExpanded));
  button.setAttribute("aria-label", actionText);
  button.title = actionText;
  if (action) action.textContent = actionText;
}

function toggleCheckinStats() {
  checkinStatsExpanded = !checkinStatsExpanded;
  saveCheckinStatsExpanded();
  syncCheckinStatsToggle();
}

function renderRosterData(data, fromFallback = false) {
  rosterData = data;
  const stats = document.getElementById("stats");
  const roster = document.getElementById("rosterList");
  const sheetLink = document.getElementById("sheetLink");
  if (sheetLink) {
    sheetLink.hidden = !data.googleSheetUrl;
    if (data.googleSheetUrl) sheetLink.href = data.googleSheetUrl;
  }

  const sessionStats = sessions.map((session) => {
    const regs = (data.registrations || []).filter((item) => item.session === session && !isCanceled(item));
    const capacity = getSessionCapacity(session);
    const remaining = getRemainingSeats(session, regs);
    const seatText = capacity ? `${regs.length} / ${capacity}` : `${regs.length} 人`;
    const hintText = remaining === 0 ? "已額滿" : remaining === null ? "點開看名單" : `剩餘 ${remaining} 位`;
    const breakdown = getCheckedInBreakdown(data, session, regs);
    return `<button class="stat stat-button" type="button" data-session="${escapeHtml(session)}" aria-label="查看 ${escapeHtml(session)} 已報名名單"><strong>${seatText}</strong><span>${session} 有效報名</span><small>${hintText}<span class="checkin-breakdown">｜${formatCheckinBreakdown(breakdown)}</span></small></button>`;
  });
  const sessionSummaries = sessions.map((session) => {
    const regs = (data.registrations || []).filter((item) => item.session === session && !isCanceled(item));
    return {
      city: getSessionCity(session),
      breakdown: getCheckedInBreakdown(data, session, regs),
      registered: regs.length,
      capacity: getSessionCapacity(session)
    };
  });
  const totalRegistered = sessionSummaries.reduce((sum, item) => sum + item.registered, 0);
  const totalCapacity = sessionSummaries.reduce((sum, item) => sum + item.capacity, 0);
  const totalBreakdown = sessionSummaries.reduce((sum, item) => {
    sum.total += item.breakdown.total;
    sum.newbie += item.breakdown.newbie;
    sum.returning += item.breakdown.returning;
    sum.unknown += item.breakdown.unknown;
    return sum;
  }, { total: 0, newbie: 0, returning: 0, unknown: 0 });
  const totalSeatText = totalCapacity ? `${totalRegistered} / ${totalCapacity}` : `${totalRegistered} 人`;
  const remainingText = totalCapacity ? `｜剩餘 ${Math.max(0, totalCapacity - totalRegistered)} 位` : "";
  const totalToggleText = checkinStatsExpanded ? "點一下收合明細" : "點一下展開明細";
  stats.innerHTML = `${sessionStats.join("")}<div class="stat stat-total stat-total-toggle" id="toggleCheckinStats" role="button" tabindex="0" aria-controls="stats" aria-expanded="${String(checkinStatsExpanded)}" aria-label="${totalToggleText}" title="${totalToggleText}"><strong>${totalBreakdown.total} 人</strong><span>全部場次簽到總計</span><small class="checkin-breakdown">${formatCheckinBreakdown(totalBreakdown)}</small>${formatCityCheckinBreakdowns(sessionSummaries)}<small>有效報名 ${totalSeatText}${remainingText}</small><span class="stat-total-action">${totalToggleText}</span></div>`;
  syncCheckinStatsToggle();

  roster.innerHTML = `${fromFallback ? `<p class="message ok">目前顯示備援名單，報名與簽到資料恢復連線後會自動更新。</p>` : ""}${sessions.map((session) => {
    const regs = (data.registrations || []).filter((item) => item.session === session && !isCanceled(item));
    const checks = (data.checkins || []).filter((item) => item.session === session);
    const people = regs.map((reg, index) => {
      const checked = checks.some((item) => item.name === reg.name);
      const status = checked ? "已報到" : "未報到";
      const type = reg.participantType || reg.type || "未填身份";
      const note = reg.note || reg.createdAt || "";
      return `<div class="person"><strong>${index + 1}. ${reg.name}</strong><span>${status}</span><em>${type}</em><small>${note}</small></div>`;
    }).join("") || `<div class="person empty">尚無資料</div>`;
    return `<section class="roster-card"><h3>${session}</h3>${people}</section>`;
  }).join("")}`;
  renderQuickCheckin();
}

async function loadRoster() {
  try {
    const res = await fetchWithApiFallback("/api/roster", { cache: "no-store" });
    if (!res.ok) throw new Error("API unavailable");
    renderRosterData(await res.json());
  } catch {
    try {
      const fallbackRes = await fetch("./roster-fallback.json", { cache: "no-store" });
      if (!fallbackRes.ok) throw new Error("Fallback unavailable");
      renderRosterData(await fallbackRes.json(), true);
    } catch {
      document.getElementById("stats").innerHTML = `<div class="stat wide"><strong>名單暫時無法讀取</strong><span>請稍後重新整理頁面。</span></div>`;
      document.getElementById("rosterList").innerHTML = `<p class="message err">名單讀取失敗，請稍後再試。</p>`;
    }
  }
}

function getCheckinPin() {
  const pinInput = document.querySelector('#checkinForm input[name="pin"]');
  return String(pinInput?.value || "").trim();
}

function loadSavedCheckinPin() {
  try {
    return String(localStorage.getItem(PIN_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function rememberCheckinPin(pin = getCheckinPin()) {
  const value = String(pin || "").trim();
  if (!value) return;
  try {
    localStorage.setItem(PIN_STORAGE_KEY, value);
  } catch {
    // Browser storage may be unavailable in private or restricted modes.
  }
}

function restoreCheckinPin() {
  const savedPin = loadSavedCheckinPin();
  const pinInput = document.querySelector('#checkinForm input[name="pin"]');
  if (pinInput && savedPin) pinInput.value = savedPin;
}

function checkedNames(session) {
  return new Set((rosterData.checkins || []).filter((item) => item.session === session).map((item) => item.name));
}

function setQuickMessage(ok, text) {
  const el = document.getElementById("quickMessage");
  if (!el) return;
  el.className = `message ${ok ? "ok" : "err"}`;
  el.textContent = text;
}

function setLastCheckin(data) {
  lastCheckin = data ? { name: data.name, session: data.session } : null;
  const box = document.getElementById("undoCheckinBox");
  const text = document.getElementById("undoCheckinText");
  if (!box || !text) return;
  if (!lastCheckin) {
    box.hidden = true;
    text.textContent = "";
    return;
  }
  text.textContent = `上一筆：${lastCheckin.session}／${lastCheckin.name}`;
  box.hidden = false;
}

function renderQuickCheckin() {
  const list = document.getElementById("quickList");
  const sessionSelect = document.querySelector('#checkinForm select[name="session"]');
  if (!list || !sessionSelect) return;
  const session = sessionSelect.value || sessions[0];
  const keyword = String(document.querySelector('#checkinForm input[name="name"]')?.value || "").trim().toLowerCase();
  const checked = checkedNames(session);
  const regs = (rosterData.registrations || [])
    .filter((item) => item.session === session && !isCanceled(item))
    .filter((item) => !keyword || String(item.name || "").toLowerCase().includes(keyword));

  list.innerHTML = regs.map((reg, index) => {
    const done = checked.has(reg.name);
    const name = escapeHtml(reg.name);
    const type = escapeHtml(reg.participantType || reg.type || "未填身分");
    return `
      <article class="staff-row ${done ? "done" : ""}">
        <div>
          <strong>${index + 1}. ${name}</strong>
          <span>${type}${done ? " · 已報到" : " · 未報到"}</span>
        </div>
        <button type="button" data-name="${name}" ${done ? "disabled" : ""}>${done ? "已報到" : "報到"}</button>
      </article>
    `;
  }).join("") || `<p class="message err">沒有符合的學員。</p>`;
}
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

document.querySelector('#registerForm select[name="participantType"]').addEventListener("change", (event) => {
  updateIntroducerRequirement(event.currentTarget.form);
});

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  unlockVoice();
  const form = event.currentTarget;
  const btn = form.querySelector("button");
  const msg = document.getElementById("registerMessage");
  if (REGISTRATION_CLOSED) {
    setMessage(msg, false, "本週密訓已停止新報名，每堂上限 30 人。請洽主辦方確認候補。" );
    return;
  }
  const payload = formData(form);
  if (payload.participantType === "新人" && !String(payload.introducer || "").trim()) {
    setMessage(msg, false, "新人報名請填寫介紹人；複訓可選填。");
    form.elements.introducer.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = "送出中...";
  try {
    const data = await postJson("/api/register", payload);
    setMessage(msg, true, `${data.name} 已完成 ${data.session} 報名`);
    showModal({
      title: "已報名成功",
      message: `${data.name} 已完成 ${data.session} 報名。`
    });
    form.reset();
    updateIntroducerRequirement(form);
    await loadRoster();
  } catch (err) {
    setMessage(msg, false, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "送出報名";
  }
});

document.getElementById("cancelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = form.querySelector("button");
  const msg = document.getElementById("cancelMessage");
  btn.disabled = true;
  btn.textContent = "取消中...";
  try {
    const data = await postJson("/api/cancel", formData(form));
    setMessage(msg, true, `${data.name} 已取消 ${data.session} 報名`);
    showModal({
      title: "已取消報名",
      message: `${data.name} 已取消 ${data.session} 報名。`
    });
    form.reset();
    await loadRoster();
  } catch (err) {
    setMessage(msg, false, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "確認取消報名";
  }
});

document.getElementById("checkinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  unlockVoice();
  const form = event.currentTarget;
  const btn = form.querySelector("button");
  const msg = document.getElementById("checkinMessage");
  const box = document.getElementById("successBox");
  btn.disabled = true;
  btn.textContent = "簽到中...";
  try {
    const payload = formData(form);
    const data = await postJson("/api/checkin", payload);
    const text = checkinVoiceText(data);
    setMessage(msg, true, "報到成功");
    document.getElementById("successText").textContent = text;
    box.hidden = false;
    setLastCheckin(data);
    speak(text);
    rememberCheckinPin(payload.pin);
    form.reset();
    restoreCheckinPin();
    await loadRoster();
  } catch (err) {
    box.hidden = true;
    setMessage(msg, false, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "送出簽到";
  }
});

const checkinPinInput = document.querySelector('#checkinForm input[name="pin"]');
restoreCheckinPin();
document.querySelector('#checkinForm select[name="session"]').addEventListener("change", renderQuickCheckin);
document.querySelector('#checkinForm input[name="name"]').addEventListener("input", renderQuickCheckin);
document.getElementById("quickRefresh").addEventListener("click", () => loadRoster().catch(() => setQuickMessage(false, "名單讀取失敗，請稍後再試。")));
document.getElementById("quickList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-name]");
  if (!button) return;
  const pin = getCheckinPin();
  if (!pin) {
    setQuickMessage(false, "請先在上方 PIN 欄輸入 PIN。");
    checkinPinInput.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "簽到中...";
  try {
    const data = await postJson("/api/checkin", {
      pin,
      session: document.querySelector('#checkinForm select[name="session"]').value,
      name: button.dataset.name
    });
    const text = checkinVoiceText(data);
    setQuickMessage(true, `${data.name} 報到成功。`);
    document.getElementById("successText").textContent = text;
    document.getElementById("successBox").hidden = false;
    setLastCheckin(data);
    speak(text);
    rememberCheckinPin(pin);
    await loadRoster();
  } catch (err) {
    setQuickMessage(false, err.message);
    button.disabled = false;
    button.textContent = "報到";
  }
});

document.getElementById("undoCheckin").addEventListener("click", async () => {
  if (!lastCheckin) {
    setQuickMessage(false, "目前沒有可返回的上一筆報到。");
    return;
  }
  const pin = getCheckinPin();
  if (!pin) {
    setQuickMessage(false, "請先在上方 PIN 欄輸入 PIN。");
    checkinPinInput.focus();
    return;
  }
  const undoButton = document.getElementById("undoCheckin");
  undoButton.disabled = true;
  undoButton.textContent = "返回中...";
  try {
    const data = await postJson("/api/checkin/undo", {
      pin,
      session: lastCheckin.session,
      name: lastCheckin.name
    });
    setQuickMessage(true, `${data.name} 已返回為未報到。`);
    document.getElementById("successBox").hidden = true;
    setLastCheckin(null);
    rememberCheckinPin(pin);
    await loadRoster();
  } catch (err) {
    setQuickMessage(false, err.message);
  } finally {
    undoButton.disabled = false;
    undoButton.textContent = "返回上一筆報到";
  }
});

document.getElementById("quickReplayVoice").addEventListener("click", () => {
  if (lastVoice) speak(lastVoice);
  else setQuickMessage(false, "目前沒有可播放的報到語音。");
});

document.getElementById("replayVoice").addEventListener("click", () => {
  if (lastVoice) speak(lastVoice);
});
document.getElementById("refreshRoster").addEventListener("click", loadRoster);
document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", closeModal);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});
document.getElementById("stats").addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const toggleButton = target?.closest("#toggleCheckinStats");
  if (toggleButton) {
    toggleCheckinStats();
    return;
  }
  const button = target?.closest("[data-session]");
  if (!button) return;
  const session = button.dataset.session;
  const count = getActiveRegistrations(session).length;
  const capacity = getSessionCapacity(session);
  const remaining = Math.max(0, capacity - count);
  showModal({
    title: `${session} 已報名名單`,
    message: capacity ? `目前有效報名 ${count} / ${capacity} 位，剩餘 ${remaining} 位。` : `目前有效報名 ${count} 位。`,
    body: renderRegistrationList(session),
    okIcon: false
  });
});
document.getElementById("stats").addEventListener("keydown", (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const toggleButton = target?.closest("#toggleCheckinStats");
  if (!toggleButton || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  toggleCheckinStats();
});

fillSessionSelects();
updateIntroducerRequirement();
loadRoster();

