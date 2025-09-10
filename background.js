// background.js — hashed password + Parent Mode only requires password for unlock/unblock

// ---------- utils ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64FromBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function bytesFromB64(b64) {
  const bin = atob(b64 || "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function normalizeHost(input) {
  try {
    const u = input.includes("://") ? new URL(input) : new URL("https://" + input);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    let h = (input || "").toLowerCase().trim();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  }
}
function hostMatches(blockedHost, actualHost) {
  return actualHost === blockedHost || actualHost.endsWith("." + blockedHost);
}

// ---------- crypto ----------
function genSalt(len = 16) {
  const salt = new Uint8Array(len);
  crypto.getRandomValues(salt);
  return salt;
}
async function deriveHash(password, saltBytes, iterations = 150000) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256
  );
  return new Uint8Array(bits); // 32 bytes
}
function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function verifyPassword(input, saltB64, hashB64) {
  if (!saltB64 || !hashB64) return false;
  const salt = bytesFromB64(saltB64);
  const target = bytesFromB64(hashB64);
  const calc = await deriveHash(String(input || ""), salt);
  return constantTimeEqual(calc, target);
}

// ---------- state ----------
async function getState() {
  return await chrome.storage.local.get({
    blockedSites: [],
    tempUnlock: {}, // {host: expiryMs}
    passwordHash: "", // base64
    passwordSalt: "", // base64
    settings: { parentMode: false }
  });
}
async function setState(patch) { return await chrome.storage.local.set(patch); }

// ---------- navigation guard ----------
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (!details.url || details.frameId !== 0) return;

  let host;
  try {
    const u = new URL(details.url);
    host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
  } catch { return; }

  const { blockedSites, tempUnlock } = await getState();

  const baseMatch = blockedSites.find((b) => hostMatches(b, host));
  if (!baseMatch) return;

  const expiry = tempUnlock[host] || tempUnlock[baseMatch];
  if (expiry && Date.now() < expiry) return;

  // Include full original URL so popup can return to exact page after unlock/unblock
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
        settings,
        hasPassword
      });
      return;
    }

    // Set/Change master password — blocked when Parent Mode is ON
    if (msg.action === "setPassword") {
      if (settings.parentMode === true) {
        sendResponse({ ok: false, error: "parent_mode_locked" });
        return;
      }
      const pw = String(msg.password ?? "").trim();
      if (!pw || pw.length < 4) { sendResponse({ ok: false, error: "weak_password" }); return; }

      const salt = genSalt(16);
      const hash = await deriveHash(pw, salt);
      await setState({
        passwordSalt: b64FromBytes(salt),
        passwordHash: b64FromBytes(hash)
      });
      sendResponse({ ok: true });
      return;
    }

    // Toggle Parent Mode (enable requires that a password exists; disable requires password verification)
    if (msg.action === "toggleParentMode") {
      const enable = !!msg.enableParentMode;

      if (enable) {
        if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
        const next = { ...settings, parentMode: true };
        await setState({ settings: next });
        sendResponse({ ok: true, settings: next });
        return;
      }

      // disable
      const pw = String(msg.password || "").trim();
      if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
      const ok = await verifyPassword(pw, state.passwordSalt, state.passwordHash);
      if (!ok) { sendResponse({ ok: false, error: "wrong_password" }); return; }

      const next = { ...settings, parentMode: false };
      await setState({ settings: next });
      sendResponse({ ok: true, settings: next });
      return;
    }

    // Add block
    if (msg.action === "block") {
      const host = normalizeHost(msg.site);
      if (!host) { sendResponse({ ok: false, error: "invalid_host" }); return; }
      const blocked = new Set(state.blockedSites);
      blocked.add(host);
      await setState({ blockedSites: Array.from(blocked) });
      sendResponse({ ok: true, host });
      return;
    }

    // Unblock — requires password ONLY when Parent Mode is ON
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
      sendResponse({ ok: true, host });
      return;
    }

    // Temporary unlock — requires password ONLY when Parent Mode is ON
    if (msg.action === "unlock") {
      const host = normalizeHost(msg.site);
      const minutes = Number(msg.minutes);
      if (!host || !minutes) { sendResponse({ ok: false, error: "bad_input" }); return; }

      if (settings.parentMode === true) {
        // must verify password
        const pw = String(msg.password || "").trim();
        if (!hasPassword) { sendResponse({ ok: false, error: "no_password_set" }); return; }
        const ok = await verifyPassword(pw, state.passwordSalt, state.passwordHash);
        if (!ok) { sendResponse({ ok: false, error: "wrong_password" }); return; }
      }
      // If Parent Mode is OFF, no password required

      const tempUnlock = { ...(state.tempUnlock || {}) };
      tempUnlock[host] = Date.now() + minutes * 60 * 1000;
      await setState({ tempUnlock });
      sendResponse({ ok: true, host, expiry: tempUnlock[host] });
      return;
    }

    sendResponse({ ok: false, error: "unknown_action" });
  })();

  return true;
});

