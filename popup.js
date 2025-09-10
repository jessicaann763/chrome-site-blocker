// Safe DOM helpers
const $ = (id) => document.getElementById(id);
const setIf = (id, fn) => { const el = $(id); if (el) fn(el); };

let gHasPassword = false; // from background getState()

function setText(id, text = "", ok = true) {
  setIf(id, (el) => {
    el.textContent = text;
    if (id === "status" || id === "unlockStatus" || id === "settingsStatus") {
      el.style.color = ok ? "#666" : "#c00";
    }
    if (text) setTimeout(() => { const e = $(id); if (e) e.textContent = ""; }, 3000);
  });
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

function renderBlocked(list) {
  setIf("blockedList", (wrap) => {
    wrap.innerHTML = "";
    if (!list || list.length === 0) {
      wrap.innerHTML = "<small>No blocked sites yet.</small>";
      return;
    }
    list.forEach((host) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = host + " ";
      const btn = document.createElement("button");
      btn.textContent = "x";
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "unblockSite", site: host }, (res) => {
          if (res?.ok) { loadState(); setText("status", `Removed ${host}.`); }
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

  list.forEach((host) => {
    const opt = document.createElement("option");
    opt.value = host;
    opt.textContent = host;
    select.appendChild(opt);
  });

  select.onchange = () => { if (unlockBtn) unlockBtn.disabled = !select.value; };
}

function setParentModePlaceholder(checked) {
  setIf("parentModePassword", (input) => {
    input.placeholder = checked
      ? "Disable Parent Mode with master password"
      : "Enable Parent Mode with master password";
  });
}

function reflectParentMode(settings) {
  const parentMode = !!(settings && settings.parentMode);
  setIf("parentModeToggle", (tgl) => { tgl.checked = parentMode; });
  setText("parentModeState", parentMode ? "ON" : "OFF");
  setParentModePlaceholder(parentMode);

  // Parent Mode DOES NOT disable unlock UI
  // Only disable password change controls when Parent Mode is ON
  setIf("newPassword", (el) => { el.disabled = parentMode; });
  setIf("savePasswordBtn", (el) => { el.disabled = parentMode; });
  if (parentMode) setText("settingsStatus", "Parent Mode is ON: password changes disabled.");
}

function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (state) => {
    const blocked = state?.blockedSites || [];
    gHasPassword = !!state?.hasPassword;
    renderBlocked(blocked);
    renderUnlockSelect(blocked);
    reflectParentMode(state?.settings);
  });
}

// --- events ---
document.addEventListener("DOMContentLoaded", () => {
  setIf("blockBtn", (btn) => {
    btn.addEventListener("click", () => {
      const site = $("siteInput")?.value.trim();
      if (!site) return setText("status", "Enter a site to block.", false);
      chrome.runtime.sendMessage({ action: "block", site }, (res) => {
        if (res?.ok) setText("status", `Blocked ${res.host}.`);
        else setText("status", "Could not block site.", false);
        if ($("siteInput")) $("siteInput").value = "";
        loadState();
      });
    });
  });

  setIf("useCurrentForBlock", (btn) => {
    btn.addEventListener("click", () => {
      currentTabHostname((h) => { if ($("siteInput")) $("siteInput").value = h || ""; });
    });
  });

  setIf("unlockBtn", (btn) => {
    btn.addEventListener("click", () => {
      const site = $("unlockSiteSelect")?.value;
      const minutes = Number($("durationSelect")?.value || 0);
      const password = $("password")?.value || "";

      if (!site) return setText("unlockStatus", "Choose a site to unlock.", false);

      chrome.runtime.sendMessage({ action: "unlock", site, minutes, password }, (res) => {
        if (res?.ok) setText("unlockStatus", `Unlocked ${res.host} for ${minutes} min.`);
        else if (res?.error === "wrong_password") setText("unlockStatus", "Wrong password.", false);
        else if (res?.error === "no_password_set") setText("unlockStatus", "No password set. Set one in Settings.", false);
        else setText("unlockStatus", "Could not unlock.", false);
      });
    });
  });

  setIf("savePasswordBtn", (btn) => {
    btn.addEventListener("click", () => {
      const pw = $("newPassword")?.value || "";
      chrome.runtime.sendMessage({ action: "setPassword", password: pw }, (res) => {
        if (res?.ok) setText("settingsStatus", "Password saved.");
        else if (res?.error === "parent_mode_locked")
          setText("settingsStatus", "Parent Mode is ON: turn it OFF to change the password.", false);
        else setText("settingsStatus", "Could not save password.", false);
      });
    });
  });

  setIf("parentModeToggle", (tgl) => {
    tgl.addEventListener("change", (e) => {
      const wantEnable = e.target.checked; // true means enabling Parent Mode
      const pw = $("parentModePassword")?.value.trim() || "";

      // Edge case: cannot enable without a master password set
      if (wantEnable && !gHasPassword) {
        setText("settingsStatus", "Set a master password before enabling Parent Mode.", false);
        e.target.checked = false; // revert
        setParentModePlaceholder(false);
        // Focus password setup to guide the user
        const np = $("newPassword"); if (np) np.focus();
        return;
      }

      // Require master password to toggle
      chrome.runtime.sendMessage(
        { action: "toggleParentMode", enableParentMode: wantEnable, password: pw },
        (res) => {
          if (res?.ok) {
            setText("settingsStatus", wantEnable ? "Parent Mode enabled." : "Parent Mode disabled.");
            reflectParentMode(res.settings);
            const pmp = $("parentModePassword"); if (pmp) pmp.value = "";
          } else if (res?.error === "wrong_password") {
            e.target.checked = !wantEnable; // revert
            reflectParentMode({ parentMode: !wantEnable });
            setText("settingsStatus", "Wrong password for Parent Mode.", false);
          } else if (res?.error === "no_password_set") {
            e.target.checked = false;
            reflectParentMode({ parentMode: false });
            setText("settingsStatus", "Set a master password before enabling Parent Mode.", false);
            const np = $("newPassword"); if (np) np.focus();
          } else {
            e.target.checked = !wantEnable;
            reflectParentMode({ parentMode: !wantEnable });
            setText("settingsStatus", "Could not update Parent Mode.", false);
          }
        }
      );
    });
  });

  loadState();
});





