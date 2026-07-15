# Privacy Policy — Reddit Cached & Companion Extension

**Last updated: July 14, 2026**

Reddit Cached is a local-first archive of your own Reddit account. The
companion browser extension exists for a single purpose: forwarding your
reddit.com session cookies to the Reddit Cached app running on **your own
computer**, so it can sync your Reddit content into a local database.

## What the extension accesses

- **reddit.com session cookies.** The extension reads the session cookies your
  browser already holds for reddit.com.
- **Extension settings.** It stores your configured local app URL (e.g.
  `http://localhost:3001`) and the timestamp/status of the last session
  forward, using the browser's extension storage, so the popup can show
  connection state.

## Where that data goes

- Session cookies are sent **only** to `http://localhost` or
  `http://127.0.0.1` — the Reddit Cached app running on your own machine. This
  restriction is enforced in the extension's code; any other destination is
  rejected.
- The extension communicates with **no other hosts**. There are no developer
  servers, no analytics, no telemetry, no error reporting, and no third-party
  services of any kind.

## What we (the developers) collect

**Nothing.** We never see your cookies, your Reddit content, your archive, or
any usage data. Everything stays between your browser, reddit.com, and the app
on your machine.

## The Reddit Cached app

The app the extension talks to stores your synced Reddit content (saved,
upvoted, submitted, and commented items, plus your inbox) in a SQLite database
on your computer. It uses your forwarded session solely to read your own data
from Reddit's API. It never posts, votes, or modifies anything on Reddit on
its own. Optional git backups go only to repositories you configure.

## Data retention and deletion

All data lives in files you control. Logging out of reddit.com is enough to
revoke access: the extension detects it and clears the forwarded session from
the local app automatically. To remove everything, also remove the extension
and delete the app's data directory
(macOS: `~/Library/Application Support/reddit-cached`, Linux:
`~/.local/share/reddit-cached`).

## Changes

If this policy changes, the update will appear in this file's history in the
public repository.

## Contact

Questions: open an issue at
<https://github.com/aurokin/reddit_cached/issues> or email
<hsadlersemail@gmail.com>.
