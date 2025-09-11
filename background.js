// background.js (MV3)

// ---------- Utilities ----------
function normalizeHost(host) {
  try {
    if (!host) return "";
    if (host.includes("://")) host = new URL(host).hostname;
    host = host.trim().toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return "";
  }
}
function hostFromUrl(u) {
  try {
    const x = new URL(u);
    let h = x.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return "";
  }
}
function isHttpHttps(u) {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}
function blockedPageBase() {
  return chrome.runtime.getURL("blocked.html");
}
function blockedUrlFor(host, targetUrl) {
  return chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(host)}&url=${encodeURIComponent(targetUrl)}`
  );
}

// ---------- State ----------
async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return (
    state || {
      blockedSites: [],      // ["twitter.com", "reddit.com"]
      tempUnlock: {},        // { "reddit.com": 1736299999999, ... }  epoch ms
      settings: { parentMode: false },
      password: ""           // store hashed in real life; plain for simplicity here
    }
  );
}
async function setState(next) {
  await chrome.storage.local.set({ state: next });
}

// ---------- Alarms / Timers ----------
function alarmNameFor(host, expiry) {
  return `relock::${host}::${expiry}`;
}
async function scheduleRelock(host, expiryMs) {
  await chrome.alarms.create(alarmNameFor(host, expiryMs), { when: expiryMs });
}

// Recreate alarms on startup (service worker may sleep)
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  const now = Date.now();
  for (const [host, expiry] of Object.entries(state.tempUnlock || {})) {
    if (expiry > now) {
      await scheduleRelock(host, expiry);
    } else {
      delete state.tempUnlock[host];
    }
  }
  await setState(state);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const m = alarm.name.match(/^relock::(.+?)::(\d+)$/);
  if (!m) return;
  const host = m[1];
  const expiry = Number(m[2]);

  const state = await getState();
  const current = state.tempUnlock?.[host] || 0;

  // Only re-lock if we're handling the latest and it's due
  if (current && current <= Date.now() && current === expiry) {
    delete state.tempUnlock[host];
    await setState(state);
    await redirectTabsBackToBlocked(host);
  }
});

// ---------- Tab helpers ----------
async function refreshAllTabsForHost(host) {
  const base = blockedPageBase();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const url = tab.url || "";
    if (!url) continue;

    if (url.startsWith(base)) {
      // blocked.html?site=...&url=...
      try {
        const u = new URL(url);
        const qs = new URLSearchParams(u.search);
        const siteParam = normalizeHost(qs.get("site") || "");
        const targetUrl = qs.get("url");
        if (!targetUrl) continue;

        const targetHost = hostFromUrl(targetUrl);
        const matches =
          targetHost === host ||
          targetHost.endsWith("." + host) ||
          (siteParam && (targetHost === siteParam || targetHost.endsWith("." + siteParam)));

        if (matches) chrome.tabs.update(tab.id, { url: targetUrl });
      } catch {}
      continue;
    }

    // Real web page: if it’s on same host, reload to let it through
    const h = hostFromUrl(url);
    if (h && (h === host || h.endsWith("." + host))) {
      chrome.tabs.reload(tab.id);
    }
  }
}

async function redirectTabsBackToBlocked(host) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    const url = tab.url || "";
    if (!isHttpHttps(url)) continue;
    const h = hostFromUrl(url);
    if (!h) continue;
    if (h === host || h.endsWith("." + host)) {
      const to = blockedUrlFor(host, url);
      chrome.tabs.update(tab.id, { url: to });
    }
  }
}

// ---------- Navigation interception ----------
async function shouldBlockUrl(u) {
  if (!isHttpHttps(u)) return false;
  const state = await getState();
  const host = hostFromUrl(u);
  if (!host) return false;

  // Check temp unlock
  const expiry = state.tempUnlock?.[host] || state.tempUnlock?.[host.split(".").slice(-2).join(".")];
  if (expiry && expiry > Date.now()) return false;

  // Check block list (exact or parent)
  const blocked = new Set(state.blockedSites.map(normalizeHost));
  if (blocked.has(host)) return true;
  // also block if parent domain appears in list (e.g., blocking "twitter.com" should catch "mobile.twitter.com")
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (blocked.has(parent)) return true;
  }
  return false;
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  try {
    const { url, tabId, frameId, transitionType } = details;
    if (frameId !== 0) return; // main frame only
    if (!(await shouldBlockUrl(url))) return;

    const host = hostFromUrl(url);
    if (!host) return;
    const to = blockedUrlFor(host, url);
    chrome.tabs.update(tabId, { url: to });
  } catch {
    // ignore
  }
}, { url: [{ schemes: ["http", "https"] }] });

// ---------- Messages from popup / blocked page ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await getState();
    switch (msg.action) {
      case "getState": {
        sendResponse({
          blockedSites: state.blockedSites || [],
          tempUnlock: state.tempUnlock || {},
          settings: state.settings || { parentMode: false },
          hasPassword: !!(state.password && state.password.length >= 4)
        });
        break;
      }
      case "block": {
        const host = normalizeHost(msg.site);
        if (!host) return sendResponse({ ok: false });
        if (["chrome.google.com"].includes(host)) return sendResponse({ ok: false });
        const set = new Set(state.blockedSites.map(normalizeHost));
        set.add(host);
        state.blockedSites = [...set];
        await setState(state);
        sendResponse({ ok: true, host });
        break;
      }
      case "unblockSite": {
        const host = normalizeHost(msg.site);
        if (!host) return sendResponse({ ok: false });
        if (state.settings?.parentMode) return sendResponse({ ok: false, error: "parent_mode_locked" });

        state.blockedSites = (state.blockedSites || []).filter((h) => normalizeHost(h) !== host);
        delete state.tempUnlock?.[host];
        await setState(state);
        sendResponse({ ok: true });
        break;
      }
      case "unlock": {
        const host = normalizeHost(msg.site);
        const minutes = Number(msg.minutes || 0);
        if (!host || !minutes) return sendResponse({ ok: false, error: "bad_input" });

        // If Parent Mode ON, require password
        if (state.settings?.parentMode) {
          const pw = (msg.password || "").trim();
          if (!state.password) return sendResponse({ ok: false, error: "no_password_set" });
          if (pw !== state.password) return sendResponse({ ok: false, error: "wrong_password" });
        }

        const proposed = Date.now() + minutes * 60_000;
        const prev = state.tempUnlock?.[host] || 0;
        const expiry = Math.max(prev, proposed);

        state.tempUnlock = state.tempUnlock || {};
        state.tempUnlock[host] = expiry;
        await setState(state);

        await scheduleRelock(host, expiry);
        await refreshAllTabsForHost(host);

        sendResponse({ ok: true, host, expiry });
        break;
      }
      case "setPassword": {
        if (state.settings?.parentMode) {
          return sendResponse({ ok: false, error: "parent_mode_locked" });
        }
        const pw = (msg.password || "").trim();
        if (!pw || pw.length < 4) return sendResponse({ ok: false, error: "weak_password" });
        state.password = pw;
        await setState(state);
        sendResponse({ ok: true });
        break;
      }
      case "toggleParentMode": {
        const enable = !!msg.enableParentMode;
        if (enable) {
          if (!state.password) return sendResponse({ ok: false, error: "no_password_set" });
          state.settings.parentMode = true;
          await setState(state);
          sendResponse({ ok: true, settings: state.settings });
        } else {
          const pw = (msg.password || "").trim();
          if (!state.password) return sendResponse({ ok: false, error: "no_password_set" });
          if (pw !== state.password) return sendResponse({ ok: false, error: "wrong_password" });
          state.settings.parentMode = false;
          await setState(state);
          sendResponse({ ok: true, settings: state.settings });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown_action" });
    }
  })();
  return true; // async
});
