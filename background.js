// background.js — hashed password, parent mode gates, exact-URL block,
// re-lock active tabs on expiry via chrome.alarms, and reserved-host guard.

const enc = new TextEncoder();

// ---------- base64 helpers ----------
function b64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64bytes(b64str) {
  const bin = atob(b64str || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- host utils ----------
function normalizeHost(input) {
  try {
    const u = input.includes("://") ? new URL(input) : new URL("https://" + input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return ""; // block only web hosts
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    let h = (input || "").trim().toLowerCase();
    if (!h) return "";
    if (h.startsWith("www.")) h = h.slice(4);
    // reject common non-host inputs
    if (h === "newtab" || h === "new tab" || h === "chrome://newtab") return "";
    return h;
  }
}
function hostMatches(blockedHost, actualHost) {
  return actualHost === blockedHost || actualHost.endsWith("." + blockedHost);
}
function isReservedHost(host) {
  if (!host) return true;
  const reserved = new Set([
    "newtab", "new-tab", "new tab",
    "chrome", "chrome-newtab", "chrome.google.com",
    "edge", "about:blank"
  ]);
  return reserved.has(host);
}

// ---------- crypto (PBKDF2-SHA256) ----------
function genSalt(len = 16) {
  const salt = new Uint8Array(len);
  crypto.getRandomValues(salt);
  return salt;
}
async function deriveHash(password, saltBytes, iterations = 150000) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}
function ctEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function verifyPassword(input, saltB64, hashB64) {
  if (!saltB64 || !hashB64) return false;
  const calc = await deriveHash(String(input || ""), b64bytes(saltB64));
  return ctEqual(calc, b64bytes(hashB64));
}

// ---------- state ----------
async function getState() {
  return await chrome.storage.local.get({
    blockedSites: [],
    tempUnlock: {},          // { host: expiryMs }
    passwordHash: "",        // base64
    passwordSalt: "",        // base64
    settings: { parentMode: false }
  });
}
async function setState(patch) { return await chrome.storage.local.set(patch); }

// ---------- schedule & enforce re-lock ----------
async function scheduleNextAlarm(stateOpt) {
  const state = stateOpt || await getState();
  const now = Date.now();
  const times = Object.values(state.tempUnlock || {}).filter(t => t > now);
  if (times.length) {
    const next = Math.min(...times);
    // small buffer so expiry is definitely in the past when we run
    chrome.alarms.create("relock", { when: next + 50 });
  } else {
    chrome.alarms.clear("relock");
  }
}

async function enforceRelock() {
  const state = await getState();
  const now = Date.now();
  const expiredHosts = Object.entries(state.tempUnlock || {})
    .filter(([_, t]) => t <= now)
    .map(([h]) => h);

  if (expiredHosts.length === 0) return;

  // clear expired keys
  const nextUnlock = { ...(state.tempUnlock || {}) };
  for (const h of expiredHosts) delete nextUnlock[h];
  await setState({ tempUnlock: nextUnlock });

  // If any tab is currently on an expired host and that host is still blocked, redirect it to blocked.html
  const blocked = new Set(state.blockedSites || []);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url) continue;
    try {
      const u = new URL(tab.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      let th = u.hostname.toLowerCase();
      if (th.startsWith("www.")) th = th.slice(4);

      for (const host of expiredHosts) {
        if (blocked.has(host) && hostMatches(host, th)) {
          const redirect = chrome.runtime.getURL(
            `blocked.html?site=${encodeURIComponent(host)}&url=${encodeURIComponent(tab.url)}`
          );
          try { await chrome.tabs.update(tab.id, { url: redirect }); } catch {}
          break;
        }
      }
    } catch { /* noop */ }
  }
}

// run enforcement when the alarm fires and then reschedule
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "relock") return;
  await enforceRelock();
  await scheduleNextAlarm();
});

// ---------- navigation guard ----------
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (!details.url || details.frameId !== 0) return;

  let host;
  try {
    const u = new URL(details.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
  } catch { return; }

  const { blockedSites, tempUnlock } = await getState();
  const baseMatch = blockedSites.find((b) => hostMatches(b, host));
  if (!baseMatch) return;

  const expiry = tempUnlock[host] || tempUnlock[baseMatch];
  if (expiry && Date.now() < expiry) return;

  const redirect = chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(baseMatch)}&url=${encodeURIComponent(details.url)}`
  );
  try { await chrome.tabs.update(details.tabId, { url: redirect }); } catch {}
}, { url: [{ urlMatches: ".*" }] });

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await getState();
    const settings = state.settings || { parentMode: false };
    const hasPassword = !!state.passwordHash;

    if (msg.action === "getState") {
      sendResponse({
        blockedSites: state.blockedSites,
        tempUnlock: state.tempUnlock,
        settings,
        hasPassword
      });
      return;
    }

    if (msg.action === "setPassword") {
      if (settings.parentMode === true) { sendResponse({ ok: false, error: "parent_mode_locked" }); return; }
      const pw = String(msg.password ?? "").trim();
      if (!pw || pw.length < 4) { sendResponse({ ok: false, error: "weak_password" }); return; }
      const salt = genSalt(16);
      const hash = await deriveHash(pw, salt);
      await setState({ passwordSalt: b64(salt), passwordHash: b64(hash) });
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === "toggleParentMode") {
      const enable = !!msg.enableParentMode;
      if (enable) {
        if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
        const next = { ...settings, parentMode: true };
        await setState({ settings: next });
        sendResponse({ ok: true, settings: next });
        return;
      }
      const pw = String(msg.password || "").trim();
      if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
      const ok = await verifyPassword(pw, state.passwordSalt, state.passwordHash);
      if (!ok) { sendResponse({ ok: false, error: "wrong_password" }); return; }
      const next = { ...settings, parentMode: false };
      await setState({ settings: next });
      sendResponse({ ok: true, settings: next });
      return;
    }

    if (msg.action === "block") {
      const host = normalizeHost(msg.site);
      if (!host || isReservedHost(host)) { sendResponse({ ok: false, error: "invalid_host" }); return; }
      const blocked = new Set(state.blockedSites);
      blocked.add(host);
      await setState({ blockedSites: Array.from(blocked) });
      sendResponse({ ok: true, host });
      return;
    }

    if (msg.action === "unblockSite") {
      const host = normalizeHost(msg.site);
      if (!host) { sendResponse({ ok: false, error: "invalid_host" }); return; }
      if (settings.parentMode === true) {
        const pw = String(msg.password || "").trim();
        if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
        const ok = await verifyPassword(pw, state.passwordSalt, state.passwordHash);
        if (!ok) { sendResponse({ ok: false, error: "wrong_password" }); return; }
      }
      const next = state.blockedSites.filter((h) => h !== host);
      const tempUnlock = { ...(state.tempUnlock || {}) };
      delete tempUnlock[host];
      await setState({ blockedSites: next, tempUnlock });
      await scheduleNextAlarm({ ...state, tempUnlock }); // reschedule if needed
      sendResponse({ ok: true, host });
      return;
    }

    if (msg.action === "unlock") {
      const host = normalizeHost(msg.site);
      const minutes = Number(msg.minutes);
      if (!host || !minutes) { sendResponse({ ok: false, error: "bad_input" }); return; }
      if (settings.parentMode === true) {
        const pw = String(msg.password || "").trim();
        if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
        const ok = await verifyPassword(pw, state.passwordSalt, state.passwordHash);
        if (!ok) { sendResponse({ ok: false, error: "wrong_password" }); return; }
      }
      const expiry = Date.now() + minutes * 60 * 1000;
      const tempUnlock = { ...(state.tempUnlock || {}) };
      tempUnlock[host] = expiry;
      await setState({ tempUnlock });
      await scheduleNextAlarm({ ...state, tempUnlock });
      sendResponse({ ok: true, host, expiry });
      return;
    }

    sendResponse({ ok: false, error: "unknown_action" });
  })();
  return true;
});

// Ensure we reschedule on startup
chrome.runtime.onInstalled.addListener(() => { scheduleNextAlarm(); });
chrome.runtime.onStartup.addListener(() => { scheduleNextAlarm(); });

