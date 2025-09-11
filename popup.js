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
  const state = await sendMessage({ action: "getState" });
  blockedList.innerHTML = "";

  state.blockedSites.forEach((site) => {
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.textContent = site;

    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.onclick = async () => {
      await sendMessage({ action: "unblockSite", site });
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
async function blockSite() {
  const site = siteInput.value.trim();
  if (!site) return;
  await sendMessage({ action: "block", site });
  siteInput.value = "";
  render();
}

blockBtn.onclick = blockSite;

// Hitting Enter behaves like clicking Block
siteInput.addEventListener("keyup", (e) => {
  if (e.key === "Enter") {
    blockSite();
  }
});

// Temp unblock action
document.getElementById("tempUnblockBtn").onclick = async () => {
  const site = document.getElementById("tempSiteInput").value.trim();
  const duration = parseInt(document.getElementById("tempDurationInput").value, 10);
  if (!site || !duration) return;
  await sendMessage({ action: "tempUnblock", site, duration });
  render();
};

render();




