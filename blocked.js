// blocked.js
(() => {
  // Tries to open a fresh, calm surface; prefers chrome newtab, falls back to about:blank
  const openCalmNewTab = () => {
    try {
      if (chrome?.tabs?.create) {
        // Prefer browser new tab. If blocked by the platform, fall back to about:blank.
        chrome.tabs.create({ url: "chrome://newtab" }, (tab) => {
          if (chrome.runtime.lastError) {
            chrome.tabs.create({ url: "about:blank" });
          }
        });
        return;
      }
    } catch {/* ignore */}

    // Last resort: window.open (works without tabs permission, but not as nice)
    try { window.open("about:blank", "_blank", "noopener"); } catch {}
  };

  // More readable back behavior: referrer > history > calm new tab
  const goBackSmart = () => {
    try {
      if (document.referrer) {
        // Avoid bouncing back into the same blocked page origin
        const ref = new URL(document.referrer);
        const here = new URL(location.href);
        if (ref.origin !== here.origin || ref.pathname !== here.pathname) {
          location.href = document.referrer;
          return;
        }
      }
    } catch {/* ignore */}

    if (history.length > 1) {
      history.back();
    } else {
      openCalmNewTab();
    }
  };

  try {
    const qs = new URLSearchParams(location.search);
    const site = (qs.get("site") || "").toLowerCase();
    const url  = qs.get("url");

    // Rotate cheeky messages
    const messages = [
      "This site is blocked",
      "Big mistake. Huge.",
      "Is this the hill you want to doomscroll on?",
      "lol nope.",
      "Access denied, champ.",
      "No ♥️",
      "Bold move, let’s see if it pays off.",
      "Was this… worth it?",
      "Game over. Insert walk outside."
    ];
    const quipEl = document.getElementById("quip");
    if (quipEl) quipEl.textContent = messages[Math.floor(Math.random() * messages.length)];

    // Show ONLY the domain
    const siteEl = document.getElementById("siteP");
    let domainToShow = site;
    if (!domainToShow && url) {
      try {
        const u = new URL(url);
        let h = (u.hostname || "").toLowerCase();
        if (h.startsWith("www.")) h = h.slice(4);
        domainToShow = h;
      } catch {/* ignore */}
    }
    if (siteEl) siteEl.textContent = domainToShow || "(unknown)";

    // Buttons
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", goBackSmart);

    const newtabBtn = document.getElementById("newtabBtn");
    if (newtabBtn) newtabBtn.addEventListener("click", openCalmNewTab);
  } catch {/* ignore */}
})();



