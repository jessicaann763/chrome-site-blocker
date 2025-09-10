// Password-based temporary unlocks + Parent Mode
// Parent Mode: prevents changing the master password, BUT still allows temporary unlocks.

const now = () => Date.now();

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

// ---------- state ----------
async function getState() {
  return await chrome.storage.local.get({
    blockedSites: [],        // string[]
    tempUnlock: {},          // { [hostname]: expiryMillis }
    password: "",            // master password
    settings: { parentMode: false }
  });
}
async function setState(patch) {
  return await chrome.storage.local.set(patch);
}

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

  // Is this host blocked (allow subdomain match)?
  const baseMatch = blockedSites.find((b) => hostMatches(b, host));
  if (!baseMatch) return;

  // Is it temporarily unlocked?
  const expiry = tempUnlock[host] || tempUnlock[baseMatch];
  if (expiry && now() < expiry) return;

  // Redirect to local blocked page
  const redirect = chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(host)}`);
  try { await chrome.tabs.update(details.tabId, { url: redirect }); } catch {}
}, { url: [{ urlMatches: ".*" }] });

// ---------- message handling ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await getState();

    if (msg.action === "getState") {
      sendResponse({
        blockedSites: state.blockedSites,
        settings: state.settings,
        hasPassword: !!state.password
      });
      return;
    }

    // Set / change password — blocked if Parent Mode is ON
    if (msg.action === "setPassword") {
      const pw = (msg.password || "").trim();
      const settings = state.settings || { parentMode: false };

      if (settings.parentMode === true) {
        sendResponse({ ok: false, error: "parent_mode_locked" });
        return;
      }
      await setState({ password: pw });
      sendResponse({ ok: true });
      return;
    }

    // Toggle Parent Mode — requires the current master password
    if (msg.action === "toggleParentMode") {
      const settings = state.settings || { parentMode: false };
      const pw = (msg.password || "").trim();
      const enable = !!msg.enableParentMode;

      // Must already have a master password to toggle Parent Mode
      if (!state.password) {
        sendResponse({ ok: false, error: "no_password_set" });
        return;
      }
      if (pw !== state.password) {
        sendResponse({ ok: false, error: "wrong_password" });
        return;
      }

      const next = { ...settings, parentMode: enable };
      await setState({ settings: next });
      sendResponse({ ok: true, settings: next });
      return;
    }

    if (msg.action === "block") {
      const host = normalizeHost(msg.site);
      if (!host) { sendResponse({ ok: false, error: "invalid_host" }); return; }
      const blocked = new Set(state.blockedSites);
      blocked.add(host);
      await setState({ blockedSites: Array.from(blocked) });
      sendResponse({ ok: true, host });
      return;
    }

    if (msg.action === "unblockSite") {
      const host = normalizeHost(msg.site);
      const next = state.blockedSites.filter((h) => h !== host);
      const tempUnlock = { ...(state.tempUnlock || {}) };
      delete tempUnlock[host];
      await setState({ blockedSites: next, tempUnlock });
      sendResponse({ ok: true, host });
      return;
    }

    // Temporary unlock — always allowed (Parent Mode does NOT block this),
    // but still requires the master password for each unlock.
    if (msg.action === "unlock") {
      const host = normalizeHost(msg.site);
      const minutes = Number(msg.minutes);
      const pw = (msg.password || "").trim();

      if (!host || !minutes) { sendResponse({ ok: false, error: "bad_input" }); return; }

      if (!state.password) {
        sendResponse({ ok: false, error: "no_password_set" });
        return;
      }
      if (pw !== state.password) {
        sendResponse({ ok: false, error: "wrong_password" });
        return;
      }

      const tempUnlock = { ...(state.tempUnlock || {}) };
      tempUnlock[host] = now() + minutes * 60 * 1000;
      await setState({ tempUnlock });
      sendResponse({ ok: true, host, expiry: tempUnlock[host] });
      return;
    }

    sendResponse({ ok: false, error: "unknown_action" });
  })();

  return true;
});





