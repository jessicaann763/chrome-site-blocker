function setText(id, text = "", ok = true) {
  const el = document.getElementById(id);
  el.textContent = text;
  if (id === "status" || id === "unlockStatus" || id === "settingsStatus") {
    el.style.color = ok ? "#666" : "#c00";
  }
  if (text) setTimeout(() => (el.textContent = ""), 3000);
}

function currentTabHostname(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      const url = new URL(tabs[0].url);
      let h = url.hostname.toLowerCase();
      if (h.startsWith("www.")) h = h.slice(4);
      cb(h);
    } catch { cb(""); }
  });
}

function renderBlocked(list) {
  const wrap = document.getElementById("blockedList");
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
}

function renderUnlockSelect(list) {
  const select = document.getElementById("unlockSiteSelect");
  const unlockBtn = document.getElementById("unlockBtn");
  select.innerHTML = "";

  if (!list || list.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No blocked sites";
    select.appendChild(opt);
    select.disabled = true;
    unlockBtn.disabled = true;
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

  select.addEventListener("change", () => {
    unlockBtn.disabled = !select.value;
  });
}

function reflectParentMode(settings) {
  const allow = settings?.allowTempUnlocks !== false; // default true
  document.getElementById("parentModeToggle").checked = !allow;

  const disabledUnlocks = !allow;
  document.getElementById("unlockSiteSelect").disabled = disabledUnlocks;
  document.getElementById("durationSelect").disabled = disabledUnlocks;
  document.getElementById("password").disabled = disabledUnlocks;
  document.getElementById("unlockBtn").disabled =
    disabledUnlocks || !document.getElementById("unlockSiteSelect").value;
  setText("unlockStatus", disabledUnlocks ? "Parent Mode is ON: unlocks disabled." : "");

  const pwLocked = !allow;
  document.getElementById("newPassword").disabled = pwLocked;
  document.getElementById("savePasswordBtn").disabled = pwLocked;
  if (pwLocked) setText("settingsStatus", "Parent Mode is ON: password changes disabled.");
}

function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (state) => {
    const blocked = state?.blockedSites || [];
    renderBlocked(blocked);
    renderUnlockSelect(blocked);
    reflectParentMode(state?.settings);
  });
}

document.getElementById("blockBtn").addEventListener("click", () => {
  const site = document.getElementById("siteInput").value.trim();
  if (!site) return setText("status", "Enter a site to block.", false);

  chrome.runtime.sendMessage({ action: "block", site }, (res) => {
    if (res?.ok) setText("status", `Blocked ${res.host}.`);
    else setText("status", "Could not block site.", false);
    document.getElementById("siteInput").value = "";
    loadState();
  });
});

document.getElementById("useCurrentForBlock").addEventListener("click", () => {
  currentTabHostname((h) => (document.getElementById("siteInput").value = h || ""));
});

document.getElementById("unlockBtn").addEventListener("click", () => {
  const site = document.getElementById("unlockSiteSelect").value;
  const minutes = Number(document.getElementById("durationSelect").value);
  const password = document.getElementById("password").value;

  if (!site) return setText("unlockStatus", "Choose a site to unlock.", false);

  chrome.runtime.sendMessage({ action: "unlock", site, minutes, password }, (res) => {
    if (res?.ok) setText("unlockStatus", `Unlocked ${res.host} for ${minutes} min.`);
    else if (res?.error === "wrong_password") setText("unlockStatus", "Wrong password.", false);
    else if (res?.error === "parent_mode") setText("unlockStatus", "Parent Mode is ON. Unlocks disabled.", false);
    else if (res?.error === "no_password_set") setText("unlockStatus", "No password set. Set one in Settings.", false);
    else setText("unlockStatus", "Could not unlock.", false);
  });
});

document.getElementById("savePasswordBtn").addEventListener("click", () => {
  const pw = document.getElementById("newPassword").value;
  chrome.runtime.sendMessage({ action: "setPassword", password: pw }, (res) => {
    if (res?.ok) setText("settingsStatus", "Password saved.");
    else if (res?.error === "parent_mode_locked")
      setText("settingsStatus", "Parent Mode is ON: turn it OFF to change the password.", false);
    else setText("settingsStatus", "Could not save password.", false);
  });
});

document.getElementById("applyParentModeBtn").addEventListener("click", () => {
  const checked = document.getElementById("parentModeToggle").checked;
  const pw = document.getElementById("parentModePassword").value;

  chrome.runtime.sendMessage(
    { action: "toggleParentMode", allowTempUnlocks: !checked, password: pw },
    (res) => {
      if (res?.ok) {
        setText("settingsStatus", checked ? "Parent Mode enabled." : "Parent Mode disabled.");
        reflectParentMode(res.settings);
      } else if (res?.error === "wrong_password") {
        setText("settingsStatus", "Wrong password for Parent Mode.", false);
      } else {
        setText("settingsStatus", "Could not update Parent Mode.", false);
      }
    }
  );
});

loadState();



