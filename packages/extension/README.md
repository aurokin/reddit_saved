# @reddit-saved/extension

Companion browser extension. Reads your `reddit.com` session cookies and forwards
them to the local Reddit Saved app on localhost. The extension never
talks to anything besides reddit.com (read) and the loopback address (write).

## What it does

- On install, on browser startup, when reddit.com cookies change, and every 30
  minutes, the extension grabs your reddit.com cookie jar, fetches `/api/me.json`
  to read your username and CSRF modhash, and POSTs all of it to
  `<your configured local app URL>/api/auth/session`.
- Cookie changes trigger an immediate sync attempt and also arm a 30-second
  alarm fallback, so Chrome's MV3 worker suspension can't drop a login/logout
  update.
- That's it. No other origins are contacted.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `packages/extension` directory.
5. Make sure you're logged in to reddit.com — click the extension's icon to
   confirm "Connected".

## Install (Firefox)

Firefox unsigned extensions are temporary (cleared on browser restart). For a
persistent install, use Firefox Developer Edition or Nightly with
`xpinstall.signatures.required = false` in `about:config`.

1. Run `npm run build` in `packages/extension`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `packages/extension/dist/firefox/manifest.json`.
5. The extension stays loaded until you close Firefox.

For a permanent install in regular Firefox, you'd need to sign the extension via
[AMO](https://addons.mozilla.org/) — out of scope for a personal-use tool.

## Permissions

- `cookies` + `*://*.reddit.com/*` — to read your reddit.com session cookies.
- `http://localhost/*` and `http://127.0.0.1/*` — to POST them to
  the local app.
- `storage` — to remember the last sync state for the popup display.
- `alarms` — for the 30-minute heartbeat re-sync, retry backoff, and durable
  cookie-change wakeups in MV3.

The extension has no other host permissions and does not request `tabs`,
`webRequest`, or browsing history access.

## Trust model

This extension can read your reddit.com session, which is equivalent to being
logged in as you. It only sends that session to localhost or `127.0.0.1`. If you don't
trust an extension you sideloaded yourself with that capability, don't install
it — read `background.js` first.

## Files

- `manifest.json` — Chrome MV3 manifest for unpacked installs.
- `manifest.firefox.json` — Firefox MV3 background-script variant used by the build.
- `scripts/build.js` — generates `dist/chrome/` and `dist/firefox/` with the right manifest.
- `background.js` — cookie listener, `/api/me.json` fetch, POST to local app.
- `popup.html` / `popup.js` — small status panel and "Sync now" button.
