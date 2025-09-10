// Master-password unlocks + Parent Mode
// - Parent Mode prevents changing the master password, but unlocks still work.
// - Enable Parent Mode: requires a NON-EMPTY master password to already exist; no password check.
// - Disable Parent Mode: requires the correct master password.

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
    blockedSites: [],
    tempUnlock: {},
    password: "",                  // master password (must be non-empty)
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

  // NEW: include the original attempted URL so we can return to it after unlock/unblock
  const redirect = chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(baseMatch)}&url=${encodeURIComponent(details.url)}`
  );
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
        hasPassword: typeof state.password === "string" && state.password.trim().length > 0
      });
      return;
    }

    // Set/Change master password — blocked when Parent Mode is ON
    if (msg.action === "setPassword") {
      const settings = state.settings || { parentMode: false };
      if (settings.parentMode === true) {
        sendResponse({ ok: false, error: "parent_mode_locked" });
        return;
      }
      const pw = String(msg.password ?? "").trim();
      if (!pw || pw.length < 4) { sendResponse({ ok: false, error: "weak_password" }); return; }
      await setState({ password: pw });
      sendResponse({ ok: true });
      return;
    }

    // Toggle Parent Mode (enable requires existing non-empty password; disable requires correct password)
    if (msg.action === "toggleParentMode") {
      const enable = !!msg.enableParentMode;
      const settings = state.settings || { parentMode: false };
      const currentPw = (state.password || "").trim();

      if (enable) {
        if (!currentPw) { sendResponse({ ok: false, error: "no_password_set" }); return; }
        const next = { ...settings, parentMode: true };
        await setState({ settings: next });
        sendResponse({ ok: true, settings: next });
        return;
      }

      const pw = String(msg.password || "").trim();
      if (!currentPw) { sendResponse({ ok: false, error: "no_password_set" }); return; }
      if (pw !== currentPw) { sendResponse({ ok: false, error: "wrong_password" }); return; }

      const next = { ...settings, parentMode: false };
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

    // Temporary unlock — allowed; requires master password
    if (msg.action === "unlock") {
      const host = normalizeHost(msg.site);
      const minutes = Number(msg.minutes);
      const pw = String(msg.password || "").trim();

      if (!host || !minutes) { sendResponse({ ok: false, error: "bad_input" }); return; }
      const currentPw = (state.password || "").trim();
      if (!currentPw) { sendResponse({ ok: false, error: "no_password_set" }); return; }
      if (pw !== currentPw) { sendResponse({ ok: false, error: "wrong_password" }); return; }

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

