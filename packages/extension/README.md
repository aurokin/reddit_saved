# @reddit-cached/extension

Companion browser extension. Reads your `reddit.com` session cookies and forwards
them to the local Reddit Cached app on localhost. The extension never
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

1. Download `reddit-cached-extension.zip` from the
   [releases page](https://github.com/aurokin/reddit_cached/releases) and
   unzip it to a permanent location (Chrome loads it from that folder, so
   don't delete it). From a source checkout, skip the download and use the
   `packages/extension` directory instead.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the unzipped folder (or `packages/extension`).
6. Make sure you're logged in to reddit.com — click the extension's icon to
   confirm "Connected".

## Install (Firefox)

Firefox unsigned extensions are temporary (cleared on browser restart). For a
persistent install, use Firefox Developer Edition or Nightly with
`xpinstall.signatures.required = false` in `about:config`.

1. Download `reddit-cached-extension-firefox.zip` from the
   [releases page](https://github.com/aurokin/reddit_cached/releases) (releases
   after v0.1.0 ship it). From a source checkout, run `bun run build` in
   `packages/extension` instead and use `dist/firefox/`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select the downloaded zip directly (or the `manifest.json` inside the
   unzipped folder / `dist/firefox/`).
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
- `activeTab` — declared in both manifests but currently unused by any shipped
  code; flagged for removal.

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
- `cookies.js` — cookie-jar helpers.
- `app-config.js` — validation and storage of the configurable local app base URL.
- `popup.html` / `popup.js` — small status panel and "Sync now" button.
