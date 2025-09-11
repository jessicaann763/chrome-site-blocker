const siteInput = document.getElementById("siteInput");
const blockBtn = document.getElementById("blockBtn");
const blockedList = document.getElementById("blockedList");
const unlockStatus = document.getElementById("unlockStatus");

// Send message helper
function sendMessage(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

// Render blocked sites
async function render() {
  const state = await sendMessage({ type: "getState" });
  blockedList.innerHTML = "";

  state.blockedSites.forEach((site) => {
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = site;

    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.onclick = async () => {
      await sendMessage({ type: "unblockSite": true, site });
      render();
    };

    pill.appendChild(btn);
    blockedList.appendChild(pill);
  });

  renderTimers(state.temporaryUnblocks);
}

// Multiple timers renderer
function renderTimers(unblocks) {
  unlockStatus.innerHTML = "";

  const entries = Object.entries(unblocks);
  if (entries.length === 0) return;

  const update = () => {
    unlockStatus.innerHTML = "";
    const now = Date.now();
    entries.forEach(([site, expiry]) => {
      const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
      if (remaining > 0) {
        const line = document.createElement("div");
        line.textContent = `${site} unblocked for ${remaining}s`;
        unlockStatus.appendChild(line);
      }
    });
  };

  update();
  setInterval(update, 1000);
}

// Add site
blockBtn.onclick = async () => {
  const site = siteInput.value.trim();
  if (!site) return;
  await sendMessage({ type: "blockSite", site });
  siteInput.value = "";
  render();
};

// Temp unblock action
document.getElementById("tempUnblockBtn").onclick = async () => {
  const site = document.getElementById("tempSiteInput").value.trim();
  const duration = parseInt(document.getElementById("tempDurationInput").value, 10);
  if (!site || !duration) return;
  await sendMessage({ type: "tempUnblock", site, duration });
  render();
};

render();




