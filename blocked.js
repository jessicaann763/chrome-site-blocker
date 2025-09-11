// blocked.js
(() => {
  const openCalmNewTab = () => {
    try {
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: "chrome://newtab" }, () => {
          if (chrome.runtime.lastError) {
            chrome.tabs.create({ url: "about:blank" });
          }
        });
        return;
      }
    } catch {}
    try { window.open("about:blank", "_blank", "noopener"); } catch {}
  };

  const goBackSmart = () => {
    try {
      if (document.referrer) {
        const ref = new URL(document.referrer);
        const here = new URL(location.href);
        if (ref.origin !== here.origin || ref.pathname !== here.pathname) {
          location.href = document.referrer;
          return;
        }
      }
    } catch {}
    if (history.length > 1) { history.back(); }
    else { openCalmNewTab(); }
  };

  try {
    const qs = new URLSearchParams(location.search);
    const site = (qs.get("site") || "").toLowerCase();
    const url  = qs.get("url");

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

    const siteEl = document.getElementById("siteP");
    let domainToShow = site;
    if (!domainToShow && url) {
      try {
        const u = new URL(url);
        let h = (u.hostname || "").toLowerCase();
        if (h.startsWith("www.")) h = h.slice(4);
        domainToShow = h;
      } catch {}
    }
    if (siteEl) siteEl.textContent = domainToShow || "(unknown)";

    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", goBackSmart);

    const newtabBtn = document.getElementById("newtabBtn");
    if (newtabBtn) newtabBtn.addEventListener("click", openCalmNewTab);
  } catch {}
})();




