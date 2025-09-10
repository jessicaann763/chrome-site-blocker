// ---- helpers ----
const now = () => Date.now();

function normalizeHost(input) {
  try {
    // allow raw host or full URL
    const u = input.includes("://") ? new URL(input) : new URL("https://" + input);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    // fallback: treat as plain host
    let h = (input || "").toLowerCase().trim();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  }
}

function hostMatches(blockedHost, actualHost) {
  // exact or subdomain match
  return (
    actualHost === blockedHost ||
    actualHost.endsWith("." + blockedHost)
  );
}

// ---- state in storage ----
async function getState() {
  return await chrome.storage.local.get({
    blockedSites: [],      // array of base domains (strings)
    tempUnlock: {},        // { [hostname]: expiryMillis }
    password: ""           // user’s phrase/password
  });
}

async function setState(patch) {
  return await chrome.storage.local.set(patch);
}

// ---- navigation guard ----
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (!details.url || details.frameId !== 0) return;

  let host;
  try {
    const u = new URL(details.url);
    host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
  } catch {
    return;
  }

  const { blockedSites, tempUnlock } = await getState();

  // is this host blocked (incl. subdomains)?
  const isBlocked = blockedSites.some((b) => hostMatches(b, host));
  if (!isBlocked) return;

  // unlocked?
  const expiry = tempUnlock[host] || tempUnlock[blockedSites.find(b => hostMatches(b, host))];
  if (expiry && now() < expiry) return;

  // redirect to local blocked page with query param
  const redirect = chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(host)}`);
  try {
    await chrome.tabs.update(details.tabId, { url: redirect });
  } catch { /* tab may no longer exist */ }
}, { url: [{ urlMatches: ".*" }] });

// ---- messages from popup ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const state = await getState();

    if (msg.action === "getState") {
      sendResponse(state);
      return;
    }

    if (msg.action === "setPassword") {
      await setState({ password: msg.password || "" });
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === "block") {
      const host = normalizeHost(msg.site);
      if (!host) return sendResponse({ ok: false, error: "invalid_host" });

      const blocked = new Set(state.blockedSites);
      blocked.add(host);
      await setState({ blockedSites: Array.from(blocked) });
      sendResponse({ ok: true, host });
      return;
    }

    if (msg.action === "unblockSite") {
      const host = normalizeHost(msg.site);
      const next = state.blockedSites.filter((h) => h !== host);
      await setState({ blockedSites: next });
      sendResponse({ ok: true, host });
      return;
    }

    if (msg.action === "unlock") {
      const host = normalizeHost(msg.site);
      const minutes = Number(msg.minutes);
      if (!host || !minutes) return sendResponse({ ok: false, error: "bad_input" });

      // require password if one is set; otherwise first provided sets it
      if (state.password) {
        if ((msg.password || "") !== state.password) {
          sendResponse({ ok: false, error: "wrong_password" });
          return;
        }
      } else {
        // set initial password to what user typed
        await setState({ password: msg.password || "" });
      }

      const expiry = now() + minutes * 60 * 1000;
      const tempUnlock = { ...(state.tempUnlock || {}) };
      tempUnlock[host] = expiry;
      await setState({ tempUnlock });

      sendResponse({ ok: true, host, expiry });
      return;
    }

    sendResponse({ ok: false, error: "unknown_action" });
  })();

  // keep channel open for async
  return true;
});

