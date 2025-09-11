let blockedSites = [];
let temporaryUnblocks = {}; // { domain: expiryTimestamp }

// Load from storage
chrome.storage.local.get(["blockedSites", "temporaryUnblocks"], (data) => {
  blockedSites = data.blockedSites || [];
  temporaryUnblocks = data.temporaryUnblocks || {};
});

// Save helper
function saveState() {
  chrome.storage.local.set({
    blockedSites,
    temporaryUnblocks,
  });
}

// Extract hostname
function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Should block?
function isBlocked(url) {
  const host = getHostname(url);
  if (!host) return false;

  // Expired unblock cleanup
  if (temporaryUnblocks[host] && Date.now() > temporaryUnblocks[host]) {
    delete temporaryUnblocks[host];
    saveState();
  }

  return blockedSites.includes(host) && !temporaryUnblocks[host];
}

// Intercept navigation
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  const { url, tabId } = details;
  if (isBlocked(url)) {
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL("blocked.html") + "?site=" + encodeURIComponent(url),
    });
  }
});

// Handle messages (use `action` to match popup.js)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getState") {
    sendResponse({ blockedSites, temporaryUnblocks });
  }

  if (msg.action === "block") {
    const host = getHostname(msg.site);
    if (host && !blockedSites.includes(host)) {
      blockedSites.push(host);
      saveState();
      sendResponse({ ok: true, host });
    } else {
      sendResponse({ ok: false });
    }
  }

  if (msg.action === "unblockSite") {
    const host = getHostname(msg.site);
    if (host) {
      blockedSites = blockedSites.filter((s) => s !== host);
      delete temporaryUnblocks[host];
      saveState();
      sendResponse({ ok: true, host });
    } else {
      sendResponse({ ok: false });
    }
  }

  if (msg.action === "tempUnblock") {
    const host = getHostname(msg.site);
    if (host) {
      temporaryUnblocks[host] = Date.now() + msg.duration * 1000;
      saveState();

      // Release *all* blocked tabs for this host
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (!tab.url) continue;
          const tHost = getHostname(tab.url);
          if (tHost === host && tab.url.includes("blocked.html")) {
            chrome.tabs.update(tab.id, { url: "https://" + host });
          }
        }
      });

      sendResponse

