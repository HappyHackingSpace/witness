# Privacy Policy - Witness Chrome Extension

**Last updated:** March 9, 2026

## Overview

Witness is an open-source Chrome extension for web evidence capture and preservation. We are committed to protecting your privacy.

## Data Collection

Witness does **not** collect, transmit, or store any personal data on external servers. The extension operates entirely within your browser.

## Data Storage

The following data is stored **locally** in your browser using IndexedDB and `chrome.storage.local`:

- **Captured web pages:** MHTML snapshots, screenshots, and page metadata are stored in IndexedDB on your device.
- **Hash chain:** SHA-256 content hashes, screenshot hashes, and evidence hashes forming a tamper-evident chain.
- **Cases, selectors, and annotations:** Investigation organization data stored locally.
- **Settings:** Capture preferences, domain rules, and UI state.

No data is synced to any cloud service or external server.

## External Services

The extension communicates with the following third-party services:

| Service | URL | Purpose |
|---------|-----|---------|
| FreeTSA | `freetsa.org/tsr` | RFC 3161 trusted timestamping |
| DigiCert TSA | `timestamp.digicert.com` | RFC 3161 trusted timestamping (fallback) |

These requests contain **only** a SHA-256 hash of the evidence, not the actual page content, screenshots, or any user data. All requests are made directly from your browser with no intermediary servers.

## Permissions

- **`activeTab`, `tabs`**: Access the current page for capture.
- **`scripting`**: Inject content scripts for selector scanning and page data extraction.
- **`webNavigation`**: Detect page navigations to trigger automatic capture.
- **`pageCapture`**: Save pages as MHTML snapshots.
- **`storage`, `unlimitedStorage`**: Store captures and settings locally.
- **`sidePanel`**: Display the Witness UI in Chrome's side panel.
- **`contextMenus`**: Add "Capture this page" to the right-click menu.
- **`debugger`**: Full-page screenshots via Chrome DevTools Protocol.
- **Host permissions (`<all_urls>`)**: Required to capture any web page the user visits.

## Data Sharing

Witness does **not** share, sell, or transfer any user data to third parties.

## Open Source

Witness is fully open source. You can audit the code at: https://github.com/HappyHackingSpace/witness

## Changes

If this policy changes, the updated version will be published in the repository and the extension listing.

## Contact

For questions about this privacy policy, open an issue at: https://github.com/HappyHackingSpace/witness/issues
