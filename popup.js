document.getElementById('blockBtn').addEventListener('click', () => {
  const site = document.getElementById('siteInput').value;
  if (site) {
    chrome.runtime.sendMessage({ action: "block", site }, (response) => {
      alert(response.status + ": " + site);
    });
  }
});

document.getElementById('unlockBtn').addEventListener('click', () => {
  const site = document.getElementById('unlockSite').value;
  const password = document.getElementById('password').value;
  if (site && password) {
    chrome.runtime.sendMessage({ action: "unlock", site, password }, (response) => {
      alert(response.status);
    });
  }
});

