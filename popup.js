// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const setIf = (id, fn) => { const el = $(id); if (el) fn(el); }; // only run if element exists

function setText(id, text = "", ok = true) {
  setIf(id, (el) => {
    el.textContent = text;
    if (id === "status" || id === "unlockStatus" || id === "settingsStatus") {
      el.style.color = ok ? "#666" : "#c00";
    }
    if (text) setTimeout(() => { if ($(id)) $(id).textContent = ""; }, 3000);
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

// ---------- renderers ----------
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
  if (!select) return; // nothing to do if missing

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

  select.onchange = () => {
    if (unlockBtn) unlockBtn.disabled = !select.value;
  };
}

function setParentModePlaceholder(checked) {
  setIf("parentModePassword", (input) => {
    input.placeholder = checked
      ? "Disable Parent Mode with master password"
      : "Enable Parent Mode with master password";
  });
}

function reflectParentMode(settings) {
  const allow = settings?.allowTempUnlocks !== false; // default true
  const checked = !allow;

  setIf("parentModeToggle", (tgl) => { tgl.checked = checked; });
  setText("parentModeState", checked ? "ON" : "OFF");
  setParentModePlaceholder(checked);

  // Disable/enable unlock UI
  const disabledUnlocks = checked;
  setIf("unlockSiteSelect", (el) => { el.disabled = disabledUnlocks; });
  setIf("durationSelect", (el) => { el.disabled = disabledUnlocks; });
  setIf("password", (el) => { el.disabled = disabledUnlocks; });
  setIf("unlockBtn", (el) => { el.disabled = disabledUnlocks || !($("unlockSiteSelect")?.value); });
  setText("unlockStatus", disabledUnlocks ? "Parent Mode is ON: unlocks disabled." : "");

  // Disable/enable password change controls
  setIf("newPassword", (el) => { el.disabled = checked; });
  setIf("savePasswordBtn", (el) => { el.disabled = checked; });
  if (checked) setText("settingsStatus", "Parent Mode is ON: password changes disabled.");
}

function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (state) => {
    const blocked = state?.blockedSites || [];
    renderBlocked(blocked);
    renderUnlockSelect(blocked);
    reflectParentMode(state?.settings);
  });
}

// ---------- wire up events after DOM ready ----------
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
        else if (res?.error === "parent_mode") setText("unlockStatus", "Parent Mode is ON. Unlocks disabled.", false);
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
      const wantEnable = e.target.checked; // checked => turn ON Parent Mode (disable unlocks)
      const pw = $("parentModePassword")?.value.trim() || "";

      chrome.runtime.sendMessage(
        { action: "toggleParentMode", allowTempUnlocks: !wantEnable, password: pw },
        (res) => {
          if (res?.ok) {
            setText("settingsStatus", wantEnable ? "Parent Mode enabled." : "Parent Mode disabled.");
            reflectParentMode(res.settings);
            if ($("parentModePassword")) $("parentModePassword").value = "";
          } else if (res?.error === "wrong_password") {
            // revert toggle if wrong password
            if ($("parentModeToggle")) $("parentModeToggle").checked = !wantEnable;
            reflectParentMode({ allowTempUnlocks: !wantEnable }); // revert UI state
            setText("settingsStatus", "Wrong password for Parent Mode.", false);
          } else {
            if ($("parentModeToggle")) $("parentModeToggle").checked = !wantEnable;
            reflectParentMode({ allowTempUnlocks: !wantEnable });
            setText("settingsStatus", "Could not update Parent Mode.", false);
          }
        }
      );
    });
  });

  // initial load
  loadState();
});
git 




