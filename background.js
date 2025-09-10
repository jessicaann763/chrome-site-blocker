let blockedSites = {};
let tempUnlock = {}; // stores temporarily unlocked sites with timestamps
const PASSWORD = "mySecret"; // change this to your desired password

// Listen for navigation
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  const url = new URL(details.url);
  const hostname = url.hostname.replace('www.', '');

  // Check temporary unlock
  if (tempUnlock[hostname]) {
    const now = Date.now();
    if (now - tempUnlock[hostname] < 5 * 60 * 1000) {
      return; // allow access
    } else {
      delete tempUnlock[hostname]; // remove expired unlock
    }
  }

  // Block site
  if (blockedSites[hostname]) {
    chrome.tabs.update(details.tabId, { url: "blocked.html" });
  }
}, { url: [{ urlMatches: '.*' }] });

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "block") {
    blockedSites[msg.site] = true;
    sendResponse({ status: "blocked" });
  } else if (msg.action === "unlock") {
    if (msg.password === PASSWORD) {
      tempUnlock[msg.site] = Date.now();
      sendResponse({ status: "unlocked" });
    } else {
      sendResponse({ status: "wrong password" });
    }
  }
});
