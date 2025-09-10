(() => {
  try {
    const qs = new URLSearchParams(location.search);
    const site = (qs.get("site") || "").toLowerCase();
    const url  = qs.get("url");

    const siteEl = document.getElementById("siteP");
    if (siteEl) siteEl.textContent = site;

    // Show the exact path the user tried to visit (for context)
    const pathEl = document.getElementById("pathInfo");
    if (pathEl && url) {
      try {
        const u = new URL(url);
        const info = `${u.pathname}${u.search}${u.hash}` || "/";
        pathEl.textContent = info;
      } catch {
        // ignore parse errors
      }
    }
  } catch {
    // ignore
  }
})();
