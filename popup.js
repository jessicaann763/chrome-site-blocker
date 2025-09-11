// popup.js — render multiple independent unlock timers

(function () {
  const $activeWrap = document.getElementById('active-unlocks');
  const $emptyMsg   = document.getElementById('no-active-unlocks');

  // local cache for smooth ticking
  let tempUnlock = {};       // { host: expiryMs }
  let tickTimer = null;

  // ---------- utils ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function msToClock(msLeft) {
    if (msLeft <= 0) return '00:00';
    const total = Math.ceil(msLeft / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${pad(m)}:${pad(s)}`;
  }

  function getState() {
    return chrome.storage.local.get({
      tempUnlock: {},
      blockedSites: [],
      settings: { parentMode: false }
    });
  }

  // ---------- render ----------
  function renderTimers() {
    const now = Date.now();
    // Cleanup expired (in case background hasn’t pruned yet)
    const entries = Object.entries(tempUnlock)
      .filter(([, t]) => t > now)
      .sort((a, b) => a[1] - b[1]); // soonest first

    // Clear container
    $activeWrap.innerHTML = '';

    if (entries.length === 0) {
      $activeWrap.style.display = 'none';
      if ($emptyMsg) $emptyMsg.style.display = 'block';
      return;
    }
    $activeWrap.style.display = 'flex';
    if ($emptyMsg) $emptyMsg.style.display = 'none';

    for (const [host, expiry] of entries) {
      const msLeft = Math.max(0, expiry - now);

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';
      row.style.gap = '8px';
      row.style.padding = '8px 10px';
      row.style.border = '1px solid currentColor';
      row.style.borderRadius = '10px';
      row.style.opacity = '0.95';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.flexDirection = 'column';
      left.style.gap = '2px';

      const hostEl = document.createElement('div');
      hostEl.textContent = host;
      hostEl.style.fontWeight = '600';
      hostEl.style.overflow = 'hidden';
      hostEl.style.textOverflow = 'ellipsis';
      hostEl.style.maxWidth = '220px';
      hostEl.style.whiteSpace = 'nowrap';

      const timeEl = document.createElement('div');
      timeEl.textContent = `Unlock ends in ${msToClock(msLeft)}`;
      timeEl.style.fontSize = '.9em';
      timeEl.style.opacity = '.8';

      left.appendChild(hostEl);
      left.appendChild(timeEl);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '6px';

      // Early relock (cancel)
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '×';
      cancelBtn.title = 'Relock now';
      cancelBtn.style.border = '1px solid currentColor';
      cancelB




