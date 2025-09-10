Here’s the full, polished `popup.js` with the password field clearing after a successful save, plus all the recent UI/logic updates (toast, countdown, “Block current site”, Parent Mode toggle + disable field/button, guards, etc.):

```javascript
// ----- helpers -----
const $ = (id) => document.getElementById(id);
const setIf = (id, fn) => { const el = $(id); if (el) fn(el); };

let gHasPassword = false; // non-empty master password?
let gParentMode  = false;
let unlockTimer;

function setText(id, text = "", ok = true) {
  setIf(id, (el) => {
    el.textContent = text;
    if (id === "status" || id === "unlockStatus" || id === "settingsStatus") {
      el.style.color = ok ? "var(--muted)" : "var(--danger)";
    }
    if (text) setTimeout(() => { const e = $(id); if (e) e.textContent = ""; }, 3000);
  });
}

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

function currentTabHostname(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      const url = new URL(tabs?.[0]?.url || "");
      let h = url.hostname.toLowerCase();
      if (h.startsWith("www.")) h = h.slice(4);
      cb(h);
    } catch { cb(""); }
  });
}

// ----- UI rendering -----
function renderBlocked(list) {
  setIf("blockedList", (wrap) => {
    wrap.innerHTML = "";
    if (!list || list.length === 0) {
      wrap.innerHTML = "<small class='muted'>No blocked sites yet.</small>";
      return;
    }
    const sorted = [...list].sort((a,b) => a.localeCompare(b));
    sorted.forEach((host) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = host + " ";
      const btn = document.createElement("button");
      btn.textContent = "✕";
      btn.title = "Unblock";
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "unblockSite", site: host }, (res) => {
          if (res?.ok) { toast(`Unblocked ${host}`); loadState(); }
        });
      });
      pill.appendChild(btn);
      wrap.appendChild(pill);
    });
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
  ph.textContent = "Select a site…";
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
}

function showUnlockCountdown(host, expiryMs) {
  clearInterval(unlockTimer);
  const el = $("unlockStatus");
  if (!el) return;
  function tick() {
    const ms = expiryMs - Date.now();
    if (ms <= 0) {
      el.textContent = "Lock restored.";
      clearInterval(unlockTimer);
      return;
    }
    const mm = Math.floor(ms / 60000);
    const ss = Math.floor((ms % 60000) / 1000);
    el.textContent = `Unlocked ${host} — ${mm}:${String(ss).padStart(2,"0")} remaining`;
  }
  tick();
  unlockTimer = setInterval(tick, 1000);
}

function applyParentModeUI(parentMode) {
  gParentMode = parentMode;

  setIf("parentModeToggle", (tgl) => { tgl.checked = parentMode; });
  setText("parentModeState", parentMode ? "ON" : "OFF");

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
    gHasPassword = !!state?.hasPassword;
    const parentMode = !!state?.settings?.parentMode;

    renderBlocked(blocked);
    renderUnlockSelect(blocked);
    applyParentModeUI(parentMode);
  });
}

// ----- events -----
document.addEventListener("DOMContentLoaded", () => {
  // Add via text input
  setIf("blockBtn", (btn) => {
    btn.addEventListener("click", () => {
      const site = $("siteInput")?.value.trim();
      if (!site) return setText("status", "Enter a site to block.", false);
      chrome.runtime.sendMessage({ action: "block", site }, (res) => {
        if (res?.ok) { toast(`Blocked ${res.host}`); $("siteInput").value = ""; }
        else setText("status", "Could not block site.", false);
        loadState();
      });
    });
  });

  // Block current site immediately
  setIf("blockCurrentBtn", (btn) => {
    btn.addEventListener("click", () => {
      currentTabHostname((h) => {
        if (!h) return setText("status", "Couldn't read current tab URL.", false);
        chrome.runtime.sendMessage({ action: "block", site: h }, (res) => {
          if (res?.ok) toast(`Blocked ${res.host}`);
          else setText("status", "Could not block site.", false);
          loadState();
        });
      });
    });
  });

  // Temporary unlock
  setIf("unlockBtn", (btn) => {
    btn.addEventListener("click", () => {
      const site = $("unlockSiteSelect")?.value;
      const minutes = Number($("durationSelect")?.value || 0);
      const password = $("password")?.value || "";
      if (!site) return setText("unlockStatus", "Choose a site to unlock.", false);

      chrome.runtime.sendMessage({ action: "unlock", site, minutes, password }, (res) => {
        if (res?.ok) {
          toast(`Unlocked ${res.host} for ${minutes}m`);
          if (res.expiry) showUnlockCountdown(res.host, res.expiry);
        } else if (res?.error === "wrong_password") setText("unlockStatus", "Wrong password.", false);
        else if (res?.error === "no_password_set") setText("unlockStatus", "No master password set. Set one in Settings.", false);
        else setText("unlockStatus", "Could not unlock.", false);
      });
    });
  });

  // Save/Change master password (only when Parent Mode is OFF)
  setIf("savePasswordBtn", (btn) => {
    btn.addEventListener("click", () => {
      const npEl = $("newPassword");
      const pw = (npEl?.value || "").trim();
      if (!pw || pw.length < 4) {
        setText("settingsStatus", "Password must be at least 4 characters.", false);
        npEl?.focus();
        return;
      }
      chrome.runtime.sendMessage({ action: "setPassword", password: pw }, (res) => {
        if (res?.ok) {
          toast("Master password saved");
          gHasPassword = true;
          applyParentModeUI(gParentMode);
          // Clear the input after successful save
          if (npEl) npEl.value = "";
        } else if (res?.error === "weak_password") {
          setText("settingsStatus", "Password must be at least 4 characters.", false);
        } else if (res?.error === "parent_mode_locked") {
          setText("settingsStatus", "Parent Mode is ON: turn it OFF to change the password.", false);
        } else {
          setText("settingsStatus", "Could not save password.", false);
        }
      });
    });
  });

  // Toggle Parent Mode
  setIf("parentModeToggle", (tgl) => {
    tgl.addEventListener("change", (e) => {
      const wantEnable = e.target.checked;

      if (wantEnable && !gHasPassword) {
        setText("settingsStatus", "Set a master password before enabling Parent Mode.", false);
        e.target.checked = false;
        applyParentModeUI(false);
        $("newPassword")?.focus();
        return;
      }

      const disablePw = ($("disableParentPassword")?.value || "").trim();

      chrome.runtime.sendMessage(
        { action: "toggleParentMode", enableParentMode: wantEnable, password: wantEnable ? "" : disablePw },
        (res) => {
          if (res?.ok) {
            toast(wantEnable ? "Parent Mode enabled" : "Parent Mode disabled");
            applyParentModeUI(res.settings.parentMode);
            if (!wantEnable) { const dp = $("disableParentPassword"); if (dp) dp.value = ""; }
          } else if (res?.error === "wrong_password") {
            e.target.checked = true; // stay ON
            applyParentModeUI(true);
            setText("settingsStatus", "Wrong password to disable Parent Mode.", false);
          } else if (res?.error === "no_password_set") {
            e.target.checked = false;
            applyParentModeUI(false);
            setText("settingsStatus", "Set a master password before enabling Parent Mode.", false);
            $("newPassword")?.focus();
          } else {
            e.target.checked = !wantEnable;
            applyParentModeUI(!wantEnable);
            setText("settingsStatus", "Could not update Parent Mode.", false);
          }
        }
      );
    });
  });

  // Dedicated "Disable Parent Mode" button
  setIf("disableParentBtn", (btn) => {
    btn.addEventListener("click", () => {
      const pw = ($("disableParentPassword")?.value || "").trim();
      chrome.runtime.sendMessage(
        { action: "toggleParentMode", enableParentMode: false, password: pw },
        (res) => {
          if (res?.ok) {
            toast("Parent Mode disabled");
            applyParentModeUI(false);
            const tgl = $("parentModeToggle"); if (tgl) tgl.checked = false;
            const dp = $("disableParentPassword"); if (dp) dp.value = "";
          } else if (res?.error === "wrong_password") {
            setText("settingsStatus", "Wrong password to disable Parent Mode.", false);
          } else {
            setText("settingsStatus", "Could not disable Parent Mode.", false);
          }
        }
      );
    });
  });

  loadState();
});
```

