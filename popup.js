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

function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (state) => {
    renderBlocked(state.blockedSites || []);
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
  const site = document.getElementById("unlockSite").value.trim();
  const password = document.getElementById("password").value;
  const minutes = Number(document.getElementById("durationSelect").value);

  if (!site) return setStatus("Enter a site to unlock.", false);

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
document.getElementById("useCurrentForUnlock").addEventListener("click", () => {
  currentTabHostname((h) => (document.getElementById("unlockSite").value = h || ""));
});

// init
loadState();

