function setStatus(text, ok = true) {
  const el = document.getElementById("status");
  el.textContent = text || "";
  el.style.color = ok ? "#0a0" : "#c00";
  if (text) setTimeout(() => (el.textContent = ""), 3000);
}

function currentTabHostname(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      const url = new URL(tabs[0].url);
      let h = url.hostname.toLowerCase();
      if (h.startsWith("www.")) h = h.slice(4);
      cb(h);
    } catch {
      cb("");
    }
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
        if (res?.ok) {
          loadState();
          setStatus(`Removed ${host} from blocked list.`);
        }
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
  unlockBtn.disabled = false;

  // default placeholder option
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

function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (state) => {
    const blocked = state?.blockedSites || [];
    renderBlocked(blocked);
    renderUnlockSelect(blocked);
  });
}

// --- event wiring ---
document.getElementById("blockBtn").addEventListener("click", () => {
  const site = document.getElementById("siteInput").value.trim();
  if (!site) return setStatus("Enter a site to block.", false);

  chrome.runtime.sendMessage({ action: "block", site }, (res) => {
    if (res?.ok) {
      setStatus(`Blocked ${res.host}.`);
      document.getElementById("siteInput").value = "";
      loadState();
    } else {
      setStatus("Could not block site.", false);
    }
  });
});

document.getElementById("unlockBtn").addEventListener("click", () => {
  const site = document.getElementById("unlockSiteSelect").value;
  const password = document.getElementById("password").value;
  const minutes = Number(document.getElementById("durationSelect").value);

  if (!site) return setStatus("Choose a site to unlock.", false);

  chrome.runtime.sendMessage({ action: "unlock", site, password, minutes }, (res) => {
    if (res?.ok) {
      setStatus(`Unlocked ${res.host} for ${minutes} min.`);
    } else if (res?.error === "wrong_password") {
      setStatus("Wrong password.", false);
    } else {
      setStatus("Could not unlock.", false);
    }
  });
});

document.getElementById("savePasswordBtn").addEventListener("click", () => {
  const pw = document.getElementById("newPassword").value;
  chrome.runtime.sendMessage({ action: "setPassword", password: pw }, (res) => {
    if (res?.ok) setStatus("Password saved.");
  });
});

document.getElementById("useCurrentForBlock").addEventListener("click", () => {
  currentTabHostname((h) => (document.getElementById("siteInput").value = h || ""));
});

// init
loadState();


