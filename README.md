Perfect — let’s expand your README to include your **Privacy Policy** section so everything is in one place. I’ll add it right after the Disclaimer for visibility. Here’s the full, polished version:

---

# Chrome Site Blocker

A simple, privacy-friendly Chrome extension that helps you block distracting or inappropriate websites.

✨ *Time to touch grass and stop doomscrolling.*

---

## Features

### Block Sites

* Add domains manually (e.g., `reddit.com`)
* Block the current tab with one click

### Temporary Unblock

* Unblock for 2, 5, 10, 15, or 30 minutes
* **When Parent Mode is OFF** → no password required
* **When Parent Mode is ON** → master password required

### Parent Mode

* Lock down the extension with a password
* Prevent changes to blocked sites
* Require password for temporary unblocks
* Disable Parent Mode only with the master password

### Password Security

* Master password stored as a **salted PBKDF2 hash** (never plaintext)
* No accounts, no cloud storage, no tracking

 **Important Note**

* If you forget your password, you will need to uninstall and reinstall.
* To preserve privacy, no accounts are required.
* You can change your password at any time if Parent Mode is disabled.
* To ensure kids don’t uninstall the extension to bypass controls, it’s suggested to use a monitored Google account.

---

##  Installation

This extension will be live on the **Chrome Web Store** soon.

In the meantime, you can install it manually for development:

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer Mode**.
4. Click **Load unpacked** and select this project folder.

---

## Disclaimer

This extension is provided **“as is”**, without warranty of any kind, express or implied. The developer makes no guarantees regarding the effectiveness of the site blocking features.

This extension should **not** be relied upon as a sole means of parental control, content filtering, or online safety. Children and technically advanced users may find ways to bypass or uninstall the extension. For stronger protection, please use:

* Chrome’s **supervised accounts**
* Google **Family Link**
* Device-level parental controls

By installing or using this extension, you agree that the developer is **not liable** for any damages, data loss, or consequences arising from its use or inability to use.

---

## Privacy Policy

**Last updated:** \09/10/2025

This extension does not collect, transmit, or share any personal or sensitive user data.

### Data Storage

* All data (blocked sites, temporary unblock timers, and Parent Mode settings) is stored **locally** in Chrome’s extension storage on your device.
* The master password is stored securely as a salted hash. The cleartext password is never stored.
* No data is sent to external servers.

### Data Collection

This extension does **not** collect or track:

* Personally identifiable information (such as names, emails, or addresses)
* Health, financial, or authentication information
* Location data
* Browsing history or website content
* User activity (clicks, keystrokes, etc.)

### Privacy by Design

* The extension is designed to work fully offline.
* Uninstalling the extension automatically deletes all stored data from your browser.

### Contact

If you have questions about this privacy policy or the extension, please contact:
Jessica Rhodes / https://github.com/jessicaann763 / jessicaann763@gmail.com






