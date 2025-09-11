// popup.js
const $ = (id) => document.getElementById(id);
const setIf = (id, fn) => { const el = $(id); if (el) fn(el); };

let gHasPassword = false;
let gParentMode  = false;
let gTempUnlock  = {};   // { host: expiryMs }
let gCountdownTicker = null;

function toast(msg, ok = true) {
  const host = $("toast");
  if (!host) return;
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `
    background:${ok ? "var(--primary)" : "var(--danger)"};
    color:${ok ? "var(--primary-fg)" : "#fff"};
    padding:10px 14px; border-radius:12px; box-shadow:var(--shadow);
    margin:auto; transform:translateY(0); opacity:.98; transition:all .25s ease;
  `;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(-6px)"; }, 1800);
  setTimeout(() => host.removeChild(el), 2200);
}
function setText(id, text = "", ok = true) {
  setIf(id, (el) => {
    el.textContent = text;
    if (id === "status" || id === "unlockStatus" || id === "settingsStatus") {
      el.style.color = ok ? "var(--muted)" : "var(--danger)";
    }
  });
}
function currentTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs?.[0]));
}
function currentTabHostname(cb) {
  currentTab((tab) => {
    try {
      const url = new URL(tab?.url || "");
      let h = url.hostname.toLowerCase();
      if (h.startsWith("www.")) h = h.slice(4);
      cb(h);
    } catch { cb(""); }
  });
}

// ---------- countdowns (multi per-site) ----------
function formatMMSS(ms) {
  if (ms <= 0) return "00:00";
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}
function startGlobalCountdownTicker() {
  if (gCountdownTicker) clearInterval(gCountdownTicker);
  gCountdownTicker = setInterval(() => {
    const now = Date.now();
    document.querySelectorAll(".pill[data-host]").forEach(pill => {
      const host = pill.getAttribute("data-host");
      const expiry = Number(pill.getAttribute("data-expiry") || 0);
      const badge = pill.querySelector(".count");
      if (!badge) return;

      const remaining = expiry - now;
      if (remaining > 0) {
        badge.textContent = formatMMSS(remaining);
      } else {
        badge.textContent = "";
        pill.removeAttribute("data-expiry");
      }
    });
  }, 1000);
}
function showUnlockCountdown(host, expiryMs) {
  const el = $("unlockStatus");
  if (!el) return;
  const ms = expiryMs - Date.now();
  el.textContent = ms > 0 ? `Unlocked ${host} — ${formatMMSS(ms)} remaining` : "";
}

// ---------- UI renderers ----------
function renderBlocked(list) {
  setIf("blockedList", (wrap) => {
    wrap.innerHTML = "";
    if (!list || list.length === 0) {
      wrap.innerHTML = "<small class='muted'>No blocked sites yet.</small>";
      return;
    }
    const now = Date.now();
    const sorted = [...list].sort((a,b) => a.localeCompare(b));
    sorted.forEach((host) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.setAttribute("data-host", host);

      const label = document.createElement("span");
      label.textContent = host;

      const badge = document.createElement("span");
      badge.className = "count";
      badge.style.cssText = "margin-left:6px;";

      const expiry = Number((gTempUnlock||{})[host] || 0);
      if (expiry > now) {
        pill.setAttribute("data-expiry", String(expiry));
        badge.textContent = formatMMSS(expiry - now);
      } else {
        badge.textContent = "";
      }

      const btn = document.createElement("button");
      btn.textContent = "✕";
      btn.title = gParentMode ? "Unblock disabled in Parent Mode" : "Unblock";

      if (gParentMode) {
        btn.addEventListener("click", () => toast("Disable Parent Mode to unblock", false));
      } else {
        btn.addEventListener("click", () => {
          chrome.runtime.sendMessage({ action: "unblockSite", site: host }, (res) => {
            if (res?.ok) {
              toast(`Unblocked ${host}`);
              loadState();
            } else {
              toast("Disable Parent Mode to unblock", false);
            }
          });
        });
      }

      pill.appendChild(label);
      pill.appendChild(badge);
      pill.appendChild(btn);
      wrap.appendChild(pill);
    });
    startGlobalCountdownTicker();
  });
}

function renderUnlockSelect(list) {
  const select = $("unlockSiteSelect");
  const unlockBtn = $("unlockBtn");
  if (!select) return;

  select.innerHTML = "";
  if (!list || list.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No blocked sites";
    select.appendChild(opt);
    select.disabled = true;
    if (unlockBtn) unlockBtn.disabled = true;
    return;
  }
  select.disabled = false;

  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select Site";
  ph.disabled = true;
  ph.selected = true;
  select.appendChild(ph);

  [...list].sort((a,b)=>a.localeCompare(b)).forEach((host) => {
    const opt = document.createElement("option");
    opt.value = host;
    opt.textContent = host;
    select.appendChild(opt);
  });

  select.onchange = () => { if (unlockBtn) unlockBtn.disabled = !select.value; };

  select.addEventListener("change", () => {
    const host = select.value;
    const t = gTempUnlock?.[host];
    if (t && t > Date.now()) showUnlockCountdown(host, t);
  });
}

function applyParentModeUI(parentMode) {
  gParentMode = parentMode;
  setIf("parentModeToggle", (tgl) => { tgl.checked = parentMode; });
  setText("parentModeState", parentMode ? "ON" : "OFF");

  const pwField = $("password");
  if (pwField) {
    pwField.disabled = !parentMode;
    pwField.placeholder = parentMode ? "Password (master)" : "No password needed (Parent Mode OFF)";
    pwField.value = "";
    pwField.classList.toggle("blurred", !parentMode);
  }
  const np = $("newPassword");
  const sp = $("savePasswordBtn");
  if (np) { np.disabled = parentMode; np.classList.toggle("blurred", parentMode); }
  if (sp) { sp.disabled = parentMode; sp.classList.toggle("blurred", parentMode); }

  const wrap = $("disableParentWrap");
  if (wrap) wrap.style.display = parentMode && gHasPassword ? "block" : "none";
}

function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (state) => {
    const blocked = state?.blockedSites || [];
    gTempUnlock = state?.tempUnlock || {};
    gHasPassword = !!state?.hasPassword;
    const parentMode = !!state?.settings?.parentMode;

    renderBlocked(blocked);
    renderUnlockSelect(blocked);
    applyParentModeUI(parentMode);

    // show status for currently selected site if any
    const host = $("unlockSiteSelect")?.value;
    if (host && gTempUnlock[host] > Date.now()) showUnlockCountdown(host, gTempUnlock[host]);
  });
}

// ---------- events ----------
document.addEventListener("DOMContentLoaded", () => {
  const triggerBlock = () => {
    const site = $("siteInput")?.value.trim();
    if (!site) return setText("status", "Enter a site to block.", false);
    chrome.runtime.sendMessage({ action: "block", site }, (res) => {
      if (res?.ok) {
        toast(`Blocked ${res.host}`);
        $("siteInput").value = "";
        loadState();
        // If current tab matches, background will redirect on navigation; we can optionally refresh:
        currentTabHostname((h) => {
          if (!h) return;
          if (h === res.host || h.endsWith("." + res.host)) {
            // poke navigation by reloading; background intercepts
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
            });
          }
        });
      } else {
        setText("status", "Invalid site.", false);
      }
    });
  };

  setIf("siteInput", (inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        triggerBlock();
      }
    });
  });
  setIf("blockBtn", (btn) => btn.addEventListener("click", triggerBlock));

  setIf("blockCurrentBtn", (btn) => {
    btn.addEventListener("click", () => {
      currentTabHostname((h) => {
        if (!h) return setText("status", "Can't block this page.", false);
        chrome.runtime.sendMessage({ action: "block", site: h }, (res) => {
          if (res?.ok) {
            toast(`Blocked ${res.host}`);
            loadState();
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]?.id) chrome.tabs.reload(tabs[0].id);
            });
          } else {
            setText("status", "Invalid site.", false);
          }
        });
      });
    });
  });

  setIf("unlockBtn", (btn) => {
    btn.addEventListener("click", () => {
      const site = $("unlockSiteSelect")?.value;
      const minutes = Number($("durationSelect")?.value || 0);
      const password = gParentMode ? ($("password")?.value || "") : "";
      if (!site) return setText("unlockStatus", "Choose a site to unlock.", false);

      chrome.runtime.sendMessage({ action: "unlock", site, minutes, password }, (res) => {
        if (res?.ok) {
          toast(`Unlocked ${res.host} for ${minutes}m`);
          if (res.expiry) showUnlockCountdown(res.host, res.expiry);
          if (gParentMode) { const f = $("password"); if (f) f.value = ""; }
          loadState();
        } else if (res?.error === "wrong_password") {
          setText("unlockStatus", "Wrong password.", false);
        } else if (res?.error === "no_password_set") {
          setText("unlockStatus", "No master password set.", false);
        } else if (res?.error === "bad_input") {
          setText("unlockStatus", "Pick a site and duration.", false);
        } else {
          setText("unlockStatus", "Could not unlock.", false);
        }
      });
    });
  });

  setIf("savePasswordBtn", (btn) => {
    btn.addEventListener("click", () => {
      const npEl = $("newPassword");
      const pw = (npEl?.value || "").trim();
      if (!pw || pw.length < 4) {
        setText("settingsStatus", "Password must be at least 4 characters.", false);
        npEl?.focus(); return;
      }
      chrome.runtime.sendMessage({ action: "setPassword", password: pw }, (res) => {
        if (res?.ok) {
          toast("Master password saved");
          gHasPassword = true;
          applyParentModeUI(gParentMode);
          if (npEl) npEl.value = "";
        } else if (res?.error === "parent_mode_locked") {
          setText("settingsStatus", "Parent Mode is ON: turn it OFF to change the password.", false);
        } else if (res?.error === "weak_password") {
          setText("settingsStatus", "Password must be at least 4 characters.", false);
        } else {
          setText("settingsStatus", "Could not save password.", false);
        }
      });
    });
  });

  setIf("parentModeToggle", (tgl) => {
    tgl.addEventListener("change", (e) => {
      const wantEnable = e.target.checked;
      if (wantEnable && !gHasPassword) {





