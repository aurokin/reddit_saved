// Cross-browser shim: Firefox exposes `browser` (promise-native), Chrome exposes
// `chrome` (callback-style; modern versions support promises too). Modern Firefox
// also exposes `chrome` as an alias, so we just use `chrome` everywhere.
import { APP_BASE_URL_KEY, candidateBaseUrls, normalizeAppBaseUrl } from "./app-config.js";
import {
  REDDIT_WWW_URL,
  filterCookiesForStore,
  filterCookiesForUrl,
  pickPrimaryStoreId,
  serializeCookieHeader,
} from "./cookies.js";

const api = globalThis.browser ?? globalThis.chrome;
const SESSION_PATH = "/api/auth/session";
const SESSION_CLEAR_PATH = "/api/auth/session/clear";
const REDDIT_DOMAINS = ["reddit.com", ".reddit.com", "www.reddit.com"];
const HEARTBEAT_MINUTES = 30;
const HEARTBEAT_ALARM = "heartbeat";
const COOKIE_SYNC_ALARM = "cookie-sync";
const COOKIE_SYNC_DELAY_MINUTES = 0.5;
const RETRY_ALARM = "session-retry";
const RETRY_DELAY_MINUTES = 0.5;
const RETRY_STORAGE_KEY = "syncRetry";
const COOKIE_SYNC_REQUESTED_AT_KEY = "cookieSyncRequestedAt";
const COOKIE_SYNC_COMPLETED_AT_KEY = "cookieSyncCompletedAt";
const LAST_SYNC_KEY = "lastSync";

async function getConfiguredBaseUrl() {
  const stored = await api.storage.local.get(APP_BASE_URL_KEY);
  return normalizeAppBaseUrl(stored[APP_BASE_URL_KEY]);
}

async function getCandidateEndpoints() {
  return candidateBaseUrls(await getConfiguredBaseUrl());
}

// In-memory state. Service workers can be killed at any time, so we also
// persist a small snapshot via storage.local for the popup to read.
let lastSync = null;
let syncInFlight = null;
let cookieSyncDrainInFlight = null;
let latestCookieSyncRequestAt = 0;

function getCurrentRedditStoreId(cookies) {
  return pickPrimaryStoreId(cookies.map((cookie) => cookie.storeId));
}

export async function getRedditCookies() {
  const matching = await api.cookies.getAll({ url: REDDIT_WWW_URL });
  const filtered = filterCookiesForUrl(matching, REDDIT_WWW_URL);
  const resolvedStoreId = getCurrentRedditStoreId(filtered);

  // Pin the cookie sync to one store so Firefox containers and incognito
  // stores cannot be merged into a single serialized Reddit session.
  return filterCookiesForStore(filtered, resolvedStoreId);
}

async function postSession(payload) {
  // Try each endpoint in turn. The local app may bind to either localhost or
  // 127.0.0.1 depending on the user's setup.
  let lastError = null;
  const endpoints = await getCandidateEndpoints();
  for (const base of endpoints) {
    try {
      const resp = await fetch(base + SESSION_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body = null;
      try {
        body = await resp.json();
      } catch {
        /* non-JSON body */
      }
      if (resp.ok) {
        return {
          ok: true,
          endpoint: base,
          username: body?.username ?? null,
        };
      }
      const message = body?.message ?? body?.error ?? `HTTP ${resp.status} from ${base}`;
      const code = body?.code ?? null;
      if (resp.status === 409 && code === "SESSION_BLOCKED") {
        return {
          ok: false,
          blocked: true,
          endpoint: base,
          error: message,
        };
      }
      if ((resp.status === 401 || resp.status === 403) && code === "SESSION_INVALID") {
        return {
          ok: false,
          invalidSession: true,
          endpoint: base,
          error: message,
        };
      }
      lastError = message;
    } catch (err) {
      lastError = `${base}: ${err?.message || err}`;
    }
  }
  return { ok: false, error: lastError ?? "no endpoint reachable" };
}

async function clearSession() {
  let lastError = null;
  const endpoints = await getCandidateEndpoints();
  for (const base of endpoints) {
    try {
      const resp = await fetch(base + SESSION_CLEAR_PATH, { method: "POST" });
      if (resp.ok) return { ok: true, endpoint: base };
      lastError = `HTTP ${resp.status} from ${base}`;
    } catch (err) {
      lastError = `${base}: ${err?.message || err}`;
    }
  }
  return { ok: false, error: lastError ?? "no endpoint reachable" };
}

async function setLastSync(state) {
  await api.storage.local.set({ [LAST_SYNC_KEY]: state });
  lastSync = state;
}

async function clearRetry() {
  await api.alarms.clear(RETRY_ALARM);
  await api.storage.local.remove(RETRY_STORAGE_KEY);
}

async function scheduleRetry(error) {
  const stored = await api.storage.local.get(RETRY_STORAGE_KEY);
  const retry = stored[RETRY_STORAGE_KEY];
  await api.storage.local.set({
    [RETRY_STORAGE_KEY]: {
      attempts: (retry?.attempts ?? 0) + 1,
      error,
      ts: Date.now(),
    },
  });
  await api.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_DELAY_MINUTES });
}

async function getCookieSyncState() {
  const stored = await api.storage.local.get([
    COOKIE_SYNC_REQUESTED_AT_KEY,
    COOKIE_SYNC_COMPLETED_AT_KEY,
  ]);
  return {
    requestedAt: stored[COOKIE_SYNC_REQUESTED_AT_KEY] ?? 0,
    completedAt: stored[COOKIE_SYNC_COMPLETED_AT_KEY] ?? 0,
  };
}

async function markCookieSyncRequested() {
  const { requestedAt } = await getCookieSyncState();
  latestCookieSyncRequestAt = Math.max(Date.now(), requestedAt + 1, latestCookieSyncRequestAt + 1);
  const nextRequestedAt = latestCookieSyncRequestAt;
  await api.storage.local.set({ [COOKIE_SYNC_REQUESTED_AT_KEY]: nextRequestedAt });
  await api.alarms.create(COOKIE_SYNC_ALARM, { delayInMinutes: COOKIE_SYNC_DELAY_MINUTES });
}

async function markCookieSyncCompleted(requestedAt) {
  if (!requestedAt) return;
  const { completedAt } = await getCookieSyncState();
  if (completedAt >= requestedAt) return;
  await api.storage.local.set({ [COOKIE_SYNC_COMPLETED_AT_KEY]: requestedAt });
}

async function reconcileLoggedOut(reason, error) {
  const result = await clearSession();
  if (result.ok) {
    await clearRetry();
  } else {
    await scheduleRetry(result.error);
  }
  const state = {
    ok: false,
    reason,
    endpoint: result.endpoint ?? null,
    error: result.ok ? error : `${error} Local app unavailable; will retry.`,
    ts: Date.now(),
  };
  await setLastSync(state);
  return state;
}

async function syncNow(reason) {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const { requestedAt } = await getCookieSyncState();
    try {
      const cookies = await getRedditCookies();
      if (cookies.length === 0) {
        return reconcileLoggedOut(
          reason,
          "No reddit.com cookies found — log in to reddit.com first.",
        );
      }
      const cookieHeader = serializeCookieHeader(cookies);
      const userAgent = navigator.userAgent;
      const payload = {
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expirationDate: c.expirationDate ?? null,
        })),
        cookieHeader,
        userAgent,
        capturedAt: Date.now(),
      };
      const result = await postSession(payload);
      if (result.invalidSession) {
        return reconcileLoggedOut("reddit-logged-out", result.error);
      }
      if (result.ok) {
        await clearRetry();
      } else if (!result.blocked) {
        await scheduleRetry(result.error);
      } else {
        await clearRetry();
      }
      const state = {
        ok: result.ok,
        reason,
        username: result.username ?? null,
        endpoint: result.endpoint ?? null,
        error: result.ok ? null : result.blocked ? result.error : `${result.error} Retrying soon.`,
        blocked: !!result.blocked,
        ts: Date.now(),
      };
      await setLastSync(state);
      return state;
    } catch (err) {
      const error = err?.message || String(err);
      await scheduleRetry(error);
      const state = {
        ok: false,
        reason,
        error: `${error} Retrying soon.`,
        ts: Date.now(),
      };
      await setLastSync(state);
      return state;
    } finally {
      await markCookieSyncCompleted(requestedAt);
    }
  })();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function flushPendingCookieSync() {
  if (cookieSyncDrainInFlight) return cookieSyncDrainInFlight;
  cookieSyncDrainInFlight = (async () => {
    if (syncInFlight) await syncInFlight;
    let state = lastSync;
    while (true) {
      const { requestedAt, completedAt } = await getCookieSyncState();
      if (requestedAt === 0 || completedAt >= requestedAt) {
        await api.alarms.clear(COOKIE_SYNC_ALARM);
        return state;
      }
      state = await syncNow("cookie-changed");
    }
  })();
  try {
    return await cookieSyncDrainInFlight;
  } finally {
    cookieSyncDrainInFlight = null;
  }
}

async function requestCookieSync() {
  await markCookieSyncRequested();
  return flushPendingCookieSync();
}

api.runtime.onInstalled.addListener(() => {
  syncNow("installed");
  api.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
});

api.runtime.onStartup?.addListener(() => {
  api.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
  syncNow("startup");
  flushPendingCookieSync();
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) syncNow("heartbeat");
  if (alarm.name === COOKIE_SYNC_ALARM) flushPendingCookieSync();
  if (alarm.name === RETRY_ALARM) syncNow("retry");
});

api.cookies.onChanged.addListener((change) => {
  const d = (change?.cookie?.domain || "").toLowerCase();
  if (REDDIT_DOMAINS.includes(d) || d.endsWith(".reddit.com")) {
    requestCookieSync().catch((err) => {
      console.error("Failed to queue cookie sync", err);
    });
  }
});

// Popup → background message channel: "sync" forces an immediate sync and
// returns the resulting state. "status" returns the cached last result.
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "sync") {
      const state = await syncNow("manual");
      sendResponse(state);
    } else if (msg?.type === "status") {
      const stored = await api.storage.local.get(LAST_SYNC_KEY);
      sendResponse(stored[LAST_SYNC_KEY] ?? lastSync ?? null);
    }
  })();
  return true; // keep the channel open for async sendResponse
});
