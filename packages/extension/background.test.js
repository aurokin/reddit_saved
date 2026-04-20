import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

let onMessageListener = null;
const addMessageListener = (listener) => {
  onMessageListener = listener;
};
const addListener = () => {};
const getCookieMock = async () => undefined;
const getAllCookiesMock = async () => [];
const getAllCookieStoresMock = async () => [];
const originalFetch = globalThis.fetch;

globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
  alarms: {
    create: async () => {},
    clear: async () => {},
    onAlarm: { addListener },
  },
  runtime: {
    onInstalled: { addListener },
    onStartup: { addListener },
    onMessage: { addListener: addMessageListener },
  },
  cookies: {
    get: (...args) => getCookieMock(...args),
    getAll: (...args) => getAllCookiesMock(...args),
    getAllCookieStores: (...args) => getAllCookieStoresMock(...args),
    onChanged: { addListener },
  },
};

let getRedditCookies;

beforeAll(async () => {
  const mod = await import("./background.js");
  getRedditCookies = mod.getRedditCookies;
});

beforeEach(() => {
  globalThis.chrome.cookies.get = async () => undefined;
  globalThis.chrome.cookies.getAll = async () => [];
  globalThis.chrome.cookies.getAllCookieStores = async () => [];
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  globalThis.chrome = undefined;
});

describe("getRedditCookies", () => {
  test("scopes the sync to the preferred reddit cookie store from all matches", async () => {
    let getAllDetails = null;
    globalThis.chrome.cookies.get = async () => {
      throw new Error("cookies.get should not be used for store resolution");
    };
    globalThis.chrome.cookies.getAll = async (details) => {
      getAllDetails = details;
      return [
        {
          name: "reddit_session",
          value: "default-session",
          domain: ".reddit.com",
          path: "/",
          storeId: "firefox-default",
        },
        {
          name: "reddit_session",
          value: "container-session",
          domain: ".reddit.com",
          path: "/",
          storeId: "firefox-container-1",
        },
      ];
    };

    const cookies = await getRedditCookies();

    expect(getAllDetails).toEqual({ url: "https://www.reddit.com/" });
    expect(cookies).toEqual([
      {
        name: "reddit_session",
        value: "default-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
    ]);
  });

  test("falls back to one preferred store when the browser returns mixed stores", async () => {
    globalThis.chrome.cookies.get = async () => {
      throw new Error("cookies.get should not be used for store resolution");
    };
    globalThis.chrome.cookies.getAll = async () => [
      {
        name: "reddit_session",
        value: "default-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
      {
        name: "reddit_session",
        value: "container-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
    ];

    const cookies = await getRedditCookies();

    expect(cookies).toEqual([
      {
        name: "reddit_session",
        value: "default-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
    ]);
  });

  test("prefers the store that actually has reddit cookies when only one store matches", async () => {
    globalThis.chrome.cookies.get = async () => {
      throw new Error("cookies.get should not be used for store resolution");
    };
    globalThis.chrome.cookies.getAll = async () => [
      {
        name: "reddit_session",
        value: "container-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
      {
        name: "loid",
        value: "loid-token",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
    ];

    const cookies = await getRedditCookies();

    expect(cookies).toEqual([
      {
        name: "reddit_session",
        value: "container-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
      {
        name: "loid",
        value: "loid-token",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
    ]);
  });

  test("does not let an arbitrary cookies.get store override the filtered cookie jar", async () => {
    globalThis.chrome.cookies.get = async () => ({
      name: "reddit_session",
      value: "container-session",
      domain: ".reddit.com",
      path: "/",
      storeId: "firefox-container-1",
    });
    globalThis.chrome.cookies.getAll = async () => [
      {
        name: "reddit_session",
        value: "default-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
      {
        name: "loid",
        value: "default-loid",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
      {
        name: "reddit_session",
        value: "container-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
    ];

    const cookies = await getRedditCookies();

    expect(cookies).toEqual([
      {
        name: "reddit_session",
        value: "default-session",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
      {
        name: "loid",
        value: "default-loid",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-default",
      },
    ]);
  });
});

describe("syncNow", () => {
  test("posts the captured cookie jar to the local app without doing its own /api/me lookup", async () => {
    globalThis.chrome.cookies.get = async () => ({
      name: "reddit_session",
      value: "session-token",
      domain: ".reddit.com",
      path: "/",
      storeId: "firefox-container-1",
    });
    globalThis.chrome.cookies.getAll = async () => [
      {
        name: "reddit_session",
        value: "session-token",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
      {
        name: "loid",
        value: "loid-token",
        domain: ".reddit.com",
        path: "/",
        storeId: "firefox-container-1",
      },
    ];

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe("http://localhost:3001/api/auth/session");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body);
      expect(body).toMatchObject({
        cookies: [
          {
            name: "reddit_session",
            value: "session-token",
            domain: ".reddit.com",
            path: "/",
            expirationDate: null,
          },
          {
            name: "loid",
            value: "loid-token",
            domain: ".reddit.com",
            path: "/",
            expirationDate: null,
          },
        ],
        cookieHeader: "reddit_session=session-token; loid=loid-token",
        userAgent: navigator.userAgent,
      });
      expect(body.username).toBeUndefined();
      expect(body.modhash).toBeUndefined();
      expect(typeof body.capturedAt).toBe("number");
      return Response.json({
        ok: true,
        username: "session-user",
        capturedAt: body.capturedAt,
      });
    };

    const state = await new Promise((resolve) => {
      const keepAlive = onMessageListener({ type: "sync" }, {}, resolve);
      expect(keepAlive).toBe(true);
    });

    expect(state).toMatchObject({
      ok: true,
      reason: "manual",
      username: "session-user",
      endpoint: "http://localhost:3001",
      error: null,
    });
  });
});
