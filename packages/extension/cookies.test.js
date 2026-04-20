import { describe, expect, test } from "bun:test";
import { filterCookiesForUrl, serializeCookieHeader } from "./cookies.js";

describe("filterCookiesForUrl", () => {
  test("keeps only cookies applicable to https://www.reddit.com/", () => {
    const cookies = filterCookiesForUrl(
      [
        { name: "reddit_session", value: "domain-cookie", domain: ".reddit.com", path: "/" },
        { name: "loid", value: "host-cookie", domain: "www.reddit.com", path: "/" },
        { name: "reddit_session", value: "old-cookie", domain: "old.reddit.com", path: "/" },
        { name: "recent_srs", value: "path-cookie", domain: "www.reddit.com", path: "/subreddits" },
      ],
      "https://www.reddit.com/",
    );

    expect(cookies).toEqual([
      { name: "reddit_session", value: "domain-cookie", domain: ".reddit.com", path: "/" },
      { name: "loid", value: "host-cookie", domain: "www.reddit.com", path: "/" },
    ]);
  });
});

describe("serializeCookieHeader", () => {
  test("preserves duplicate cookie names with different scopes", () => {
    const header = serializeCookieHeader([
      { name: "reddit_session", value: "domain-cookie", domain: ".reddit.com", path: "/" },
      { name: "loid", value: "loid-value", domain: ".reddit.com", path: "/" },
      { name: "reddit_session", value: "host-cookie", domain: "www.reddit.com", path: "/" },
    ]);

    expect(header).toBe(
      "reddit_session=domain-cookie; loid=loid-value; reddit_session=host-cookie",
    );
  });
});
