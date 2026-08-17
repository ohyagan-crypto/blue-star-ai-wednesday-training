const DEFAULT_API_BASE = location.hostname.endsWith("loca.lt") ? location.origin : "https://solely-sleeve-furthermore-ons.trycloudflare.com";
const PIN_STORAGE_KEY = "blueCourseStaffPin";
let activeApiBase = DEFAULT_API_BASE;
let apiBases = [DEFAULT_API_BASE];
const sessions = ["8/26 AI 龍蝦智能體趨勢班","9/2 剪映 & 數字人實戰班"];

let rosterData = { registrations: [], checkins: [] };

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

function clean(value) {
  return String(value || "").trim();
}

function isCanceled(reg) {
  return reg.status === "cancelled" || reg.cancelled === true || Boolean(reg.cancelledAt);
}

function setMessage(ok, text) {
  const el = document.getElementById("staffMessage");
  el.className = `message ${ok ? "ok" : "err"}`;
  el.textContent = text;
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

function currentSession() {
  return document.getElementById("staffSession").value;
}

function getPin() {
  return clean(document.getElementById("staffPin").value);
}

function loadSavedPin() {
  try {
    return clean(localStorage.getItem(PIN_STORAGE_KEY));
  } catch {
    return "";
  }
}

function rememberPin(pin = getPin()) {
  const value = clean(pin);
  if (!value) return;
  try {
    localStorage.setItem(PIN_STORAGE_KEY, value);
  } catch {
    // Browser storage may be unavailable in private or restricted modes.
  }
}

function restoreSavedPin() {
  const savedPin = loadSavedPin();
  if (savedPin) document.getElementById("staffPin").value = savedPin;
}

function checkedNames(session) {
  return new Set((rosterData.checkins || []).filter((item) => item.session === session).map((item) => item.name));
}

function renderStats() {
  const stats = document.getElementById("staffStats");
  stats.innerHTML = sessions.map((session) => {
    const regs = (rosterData.registrations || []).filter((item) => item.session === session && !isCanceled(item));
    const checked = checkedNames(session);
    const checkedIn = regs.filter((reg) => checked.has(reg.name)).length;
    return `<div class="stat"><strong>${checkedIn}/${regs.length}</strong><span>${session}</span></div>`;
  }).join("");
}

function renderList() {
  const session = currentSession();
  const keyword = clean(document.getElementById("staffSearch").value).toLowerCase();
  const checked = checkedNames(session);
  const regs = (rosterData.registrations || [])
    .filter((item) => item.session === session && !isCanceled(item))
    .filter((item) => !keyword || String(item.name || "").toLowerCase().includes(keyword));

  document.getElementById("staffList").innerHTML = regs.map((reg, index) => {
    const done = checked.has(reg.name);
    const type = reg.participantType || reg.type || "";
    const name = escapeHtml(reg.name);
    return `
      <article class="staff-row ${done ? "done" : ""}">
        <div>
          <strong>${index + 1}. ${name}</strong>
          <span>${escapeHtml(type || "未填身分")}${done ? " · 已報到" : " · 未報到"}</span>
        </div>
        <button type="button" data-name="${name}" ${done ? "disabled" : ""}>${done ? "已報到" : "報到"}</button>
      </article>
    `;
  }).join("") || `<p class="message err">沒有符合的學員。</p>`;
}

async function loadRoster() {
  setMessage(true, "讀取名單中...");
  const res = await fetchWithApiFallback("/api/roster", { cache: "no-store" });
  if (!res.ok) throw new Error("名單讀取失敗，請稍後再試。");
  rosterData = await res.json();
  renderStats();
  renderList();
  setMessage(true, "名單已更新。");
}

async function checkIn(name, button) {
  const pin = getPin();
  if (!pin) {
    setMessage(false, "請先輸入 PIN。");
    document.getElementById("staffPin").focus();
    return;
  }

  button.disabled = true;
  button.textContent = "簽到中...";
  try {
    const res = await fetchWithApiFallback("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, session: currentSession(), name })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.message || "簽到失敗，請稍後再試。");
    setMessage(true, `${name} 報到成功。`);
    rememberPin(pin);
    await loadRoster();
  } catch (err) {
    setMessage(false, err.message);
    button.disabled = false;
    button.textContent = "報到";
  }
}

restoreSavedPin();
document.getElementById("staffSession").addEventListener("change", renderList);
document.getElementById("staffSearch").addEventListener("input", renderList);
document.getElementById("staffRefresh").addEventListener("click", () => loadRoster().catch((err) => setMessage(false, err.message)));
document.getElementById("staffList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-name]");
  if (!button) return;
  checkIn(button.dataset.name, button);
});

loadRoster().catch((err) => setMessage(false, err.message));

