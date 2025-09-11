// background.js — unblock-all-tabs fix + robust temp-unlock timers

// ---------- small utils ----------
function normalizeHost(input) {
  try {
    const u = input.includes("://") ? new URL(input) : new URL("https://" + input);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    let h = (input || "").trim().toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  }
}

function hostMatches(blockedHost, actualHost) {
  return actualHost === blockedHost || actualHost.endsWith("." + blockedHost);
}

function getHostFromUrl(url) {
  try {
    const u = new URL(url);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}

function isHttpLike(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getBlockedPageUrl(site, targetUrl) {
  return chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(site)}&url=${encodeURIComponent(targetUrl || "")}`
  );
}

// ---------- storage helpers ----------
async function getState() {
  return chrome.storage.local.get({
    blockedSites: [],       // string[] hostnames (no scheme)
    tempUnlock: {},         // { [host: string]: number (expiryMs) }
  });
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
}

// ---------- alarm scheduling ----------
async function scheduleNextAlarm(stateOpt) {
  const state = stateOpt || await getState();
  const now = Date.now();
  const times = Object.values(state.tempUnlock || {}).filter(t => t > now);
  if (times.length) {
    const next = Math.min(...times);
    await chrome.alarms.create("relock", { when: next + 25 });
  } else {
    await chrome.alarms.clear("relock");
  }
}

async function enforceRelock() {
  const state = await getState();
  const now = Date.now();

  const nextUnlock = { ...(state.tempUnlock || {}) };
  let changed = false;
  for (const [h, t] of Object.entries(nextUnlock)) {
    if (t <= now) {
      delete nextUnlock[h];
      changed = true;
    }
  }
  if (changed) {
    await setState({ tempUnlock: nextUnlock });
  }
  await scanAllTabsAndRedirect({ ...state, tempUnlock: nextUnlock });
  await scheduleNextAlarm({ ...state, tempUnlock: nextUnlock });
}

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === "relock") enforceRelock();
});

// ---------- core: (re)apply blocking to all open tabs ----------
async function scanAllTabsAndRedirect(stateOpt) {
  const state = stateOpt || await getState();
  const blocked = state.blockedSites || [];
  if (!blocked.length) return;

  const tabs = await chrome.tabs.query({});
  const now = Date.now();

  for (const tab of tabs) {
    if (!tab.url || !isHttpLike(tab.url)) continue;

    const host = getHostFromUrl(tab.url);
    if (!host) continue;

    const matchingRule = blocked.find(b => hostMatches(b, host));
    if (!matchingRule) continue;

    // temp unlocked?
    const unlockedDirect = state.tempUnlock?.[host];
    const unlockedInherited = blocked
      .filter(b => hostMatches(b, host))
      .map(b => state.tempUnlock?.[b])
      .find(Boolean);
    const expiry = unlockedDirect || unlockedInherited;
    const isUnlocked = typeof expiry === "number" && expiry > now;

    if (!isUnlocked) {
      const redirect = getBlockedPageUrl(matchingRule, tab.url);
      try {
        await chrome.tabs.update(tab.id, { url: redirect });
      } catch { /* ignore closed/denied */ }
    }
  }
}

// ---------- NEW: when a host gets unlocked, free ALL relevant tabs ----------
function isBlockedPageUrl(url) {
  try {
    return url.startsWith(chrome.runtime.getURL("blocked.html"));
  } catch { return false; }
}

function getOriginalTargetFromBlockedUrl(url) {
  try {
    const u = new URL(url);
    const qs = new URLSearchParams(u.search);
    return qs.get("url") || "";
  } catch { return ""; }
}

async function applyUnlockToAllTabsForHost(host) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const url = tab.url || "";
    if (!url) continue;

    if (isBlockedPageUrl(url)) {
      // If it's our blocked page, try to restore the original target IF it matches the unlocked host
      const original = getOriginalTargetFromBlockedUrl(url);
      const targetHost = getHostFromUrl(original);
      const matches = targetHost && (targetHost === host || targetHost.endsWith("." + host));
      if (matches) {
        const dest = original || (`https://${host}/`);
        try { await chrome.tabs.update(tab.id, { url: dest }); } catch {}
      }
    } else if (isHttpLike(url)) {
      // If it's already on the site (e.g., another tab that was just redirected and user went back),
      // nothing to do; future navigations will pass due to tempUnlock. But if it was *stuck* on
      // a blocked page URL variant, the previous branch handles it.
      const tabHost = getHostFromUrl(url);
      if (tabHost && (tabHost === host || tabHost.endsWith("." + host))) {
        // Already on unlocked host; just leave it.
      }
    }
  }
}

// ---------- network gate: redirect block unless temp-unlocked ----------
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const { blockedSites, tempUnlock } = await getState();
    if (!blockedSites?.length) return {};

    const url = details.url;
    if (!isHttpLike(url)) return {};

    const host = getHostFromUrl(url);
    if (!host) return {};

    const matchingRule = blockedSites.find(b => hostMatches(b, host));
    if (!matchingRule) return {};

    const now = Date.now();
    const expiry = tempUnlock?.[host] || blockedSites.map(b => tempUnlock?.[b]).find(Boolean);
    const isUnlocked = typeof expiry === "number" && expiry > now;

    if (isUnlocked) return {}; // allow
    return { redirectUrl: getBlockedPageUrl(matchingRule, url) };
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"]
);

// ---------- react to storage changes (this is the magic for ALL tabs) ----------
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  // If block list changed, re-scan all tabs (newly blocked should redirect; removed should release)
  if (changes.blockedSites) {
    await scanAllTabsAndRedirect();
  }

  // If tempUnlock changed:
  if (changes.tempUnlock) {
    const oldTU = changes.tempUnlock.oldValue || {};
    const newTU = changes.tempUnlock.newValue || {};

    // schedule alarm for the soonest expiry
    await scheduleNextAlarm({ tempUnlock: newTU, ...(await getState()) });

    // Find hosts that were newly added or extended
    const now = Date.now();
    const newlyUnlocked = [];
    for (const [h, exp] of Object.entries(newTU)) {
      const oldExp = oldTU[h] || 0;
      if (typeof exp === "number" && exp > now && exp !== oldExp) {
        newlyUnlocked.push(h);
      }
    }

    // Immediately free ALL tabs for each newly unlocked host
    for (const host of newlyUnlocked) {
      await applyUnlockToAllTabsForHost(host);
    }

    // If some hosts were removed (manual relock or expiry), re-enforce blocks
    const removed = Object.keys(oldTU).filter(h => !(h in newTU));
    if (removed.length) {
      await scanAllTabsAndRedirect();
    }
  }
});

// ---------- install/startup ----------
chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await scheduleNextAlarm(state);
  await scanAllTabsAndRedirect(state);
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  await scheduleNextAlarm(state);
  await scanAllTabsAndRedirect(state);
});
