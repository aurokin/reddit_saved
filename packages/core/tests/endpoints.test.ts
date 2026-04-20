import { describe, expect, test } from "bun:test";
import {
  buildCommentContextRequest,
  buildCommentThreadRequest,
  buildCommentsRequest,
  buildContentPageRequest,
  buildMeRequest,
  buildUnsaveRequest,
  buildUserAgent,
} from "../src/api/endpoints";
import { REDDIT_OAUTH_BASE_URL } from "../src/constants";
import type { AuthContext } from "../src/types";

function bearerAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    headers: { Authorization: "Bearer tok", "User-Agent": "ua" },
    baseUrl: REDDIT_OAUTH_BASE_URL,
    pathSuffix: "",
    username: "user1",
    ...overrides,
  };
}

function cookieAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    headers: { Cookie: "reddit_session=abc", "User-Agent": "Mozilla/5.0" },
    baseUrl: "https://www.reddit.com",
    pathSuffix: ".json",
    username: "user1",
    ...overrides,
  };
}

describe("buildUserAgent", () => {
  test("fills template with username", () => {
    const ua = buildUserAgent("testuser");
    expect(ua).toContain("testuser");
    expect(ua).toContain("reddit-saved");
  });

  test("falls back to 'unknown' for empty username", () => {
    const ua = buildUserAgent("");
    expect(ua).toContain("unknown");
  });
});

describe("buildContentPageRequest", () => {
  test("builds correct URL without cursor", () => {
    const params = buildContentPageRequest(bearerAuth(), "saved", 100);
    expect(params.url).toBe(`${REDDIT_OAUTH_BASE_URL}/user/user1/saved?limit=100`);
    expect(params.method).toBe("GET");
    expect(params.headers?.Authorization).toBe("Bearer tok");
    expect(params.headers?.["User-Agent"]).toBe("ua");
  });

  test("appends after cursor when provided", () => {
    const params = buildContentPageRequest(bearerAuth(), "saved", 100, "cursor123");
    expect(params.url).toContain("&after=cursor123");
  });

  test("does not append after when null", () => {
    const params = buildContentPageRequest(bearerAuth(), "upvoted", 50, null);
    expect(params.url).not.toContain("after");
  });

  test("appends pathSuffix from auth context (cookie mode appends .json)", () => {
    const params = buildContentPageRequest(cookieAuth(), "saved", 100);
    expect(params.url).toBe("https://www.reddit.com/user/user1/saved.json?limit=100");
    expect(params.headers?.Cookie).toBe("reddit_session=abc");
    expect(params.headers?.Authorization).toBeUndefined();
  });
});

describe("buildUnsaveRequest", () => {
  test("builds POST request with correct body and headers", () => {
    const params = buildUnsaveRequest(bearerAuth(), "t3_abc123");
    expect(params.method).toBe("POST");
    expect(params.url).toBe(`${REDDIT_OAUTH_BASE_URL}/api/unsave`);
    expect(params.body).toBe("id=t3_abc123");
    expect(params.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(params.headers?.Authorization).toBe("Bearer tok");
  });

  test("forwards extra auth headers (e.g. x-modhash) through to POST", () => {
    const params = buildUnsaveRequest(
      cookieAuth({
        headers: {
          Cookie: "reddit_session=abc",
          "User-Agent": "Mozilla/5.0",
          "x-modhash": "deadbeef",
        },
      }),
      "t3_abc123",
    );
    expect(params.headers?.["x-modhash"]).toBe("deadbeef");
    expect(params.headers?.Cookie).toBe("reddit_session=abc");
  });
});

describe("buildMeRequest", () => {
  test("builds GET request to /api/v1/me", () => {
    const params = buildMeRequest(bearerAuth());
    expect(params.url).toBe(`${REDDIT_OAUTH_BASE_URL}/api/v1/me`);
    expect(params.method).toBe("GET");
    expect(params.headers?.Authorization).toBe("Bearer tok");
  });

  test("uses /api/me.json in cookie mode", () => {
    const params = buildMeRequest(cookieAuth());
    expect(params.url).toBe("https://www.reddit.com/api/me.json");
  });
});

describe("buildCommentsRequest", () => {
  test("builds URL with defaults", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc");
    expect(params.url).toContain("/r/test/comments/abc.json");
    expect(params.url).toContain("limit=100");
    expect(params.url).toContain("depth=5");
    expect(params.url).toContain("sort=top");
  });

  test("respects custom parameters", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc", 50, 3, "new");
    expect(params.url).toContain("limit=50");
    expect(params.url).toContain("depth=3");
    expect(params.url).toContain("sort=new");
  });
});

describe("buildCommentContextRequest", () => {
  test("builds URL with context parameter", () => {
    const params = buildCommentContextRequest(bearerAuth(), "/r/test/comments/abc/xyz", 5);
    expect(params.url).toContain("context=5");
  });

  test("clamps context depth to 1-10", () => {
    const low = buildCommentContextRequest(bearerAuth(), "/r/test/comments/abc/xyz", 0);
    expect(low.url).toContain("context=1");

    const high = buildCommentContextRequest(bearerAuth(), "/r/test/comments/abc/xyz", 99);
    expect(high.url).toContain("context=10");
  });
});

describe("buildCommentThreadRequest", () => {
  test("builds correct URL", () => {
    const params = buildCommentThreadRequest(bearerAuth(), "abc123", "typescript", "new");
    expect(params.url).toContain("/r/typescript/comments/abc123.json");
    expect(params.url).toContain("sort=new");
  });

  test("defaults to sort=best", () => {
    const params = buildCommentThreadRequest(bearerAuth(), "abc123", "typescript");
    expect(params.url).toContain("sort=best");
  });
});

describe("URL encoding", () => {
  test("buildContentPageRequest encodes special characters in username", () => {
    const params = buildContentPageRequest(
      bearerAuth({ username: "user with spaces" }),
      "saved",
      100,
    );
    expect(params.url).toContain("/user/user%20with%20spaces/");
    expect(params.url).not.toContain("user with spaces");
  });

  test("buildContentPageRequest encodes after cursor", () => {
    const params = buildContentPageRequest(bearerAuth(), "saved", 100, "t3_abc=123&foo");
    expect(params.url).toContain("after=t3_abc%3D123%26foo");
  });

  test("buildContentPageRequest encodes endpoint", () => {
    const params = buildContentPageRequest(bearerAuth(), "saved&extra", 100);
    expect(params.url).toContain("/saved%26extra?");
  });

  test("buildUnsaveRequest encodes fullname in body", () => {
    const params = buildUnsaveRequest(bearerAuth(), "t3_abc=def");
    expect(params.body).toBe("id=t3_abc%3Ddef");
  });

  test("buildCommentThreadRequest encodes subreddit and sort", () => {
    const params = buildCommentThreadRequest(bearerAuth(), "abc", "sub/reddit", "top&malicious");
    expect(params.url).toContain("/r/sub%2Freddit/");
    expect(params.url).toContain("sort=top%26malicious");
  });

  test("buildCommentThreadRequest encodes postId", () => {
    const params = buildCommentThreadRequest(bearerAuth(), "abc/def", "typescript");
    expect(params.url).toContain("/comments/abc%2Fdef.json");
  });

  test("buildCommentsRequest encodes sort parameter", () => {
    const params = buildCommentsRequest(
      bearerAuth(),
      "/r/test/comments/abc",
      100,
      5,
      "new&bad" as "new",
    );
    expect(params.url).toContain("sort=new%26bad");
  });

  test("buildCommentsRequest rejects percent-encoded permalink", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc%20def")).toThrow(
      "must not contain",
    );
  });

  test("buildContentPageRequest accepts custom baseUrl via auth context", () => {
    const params = buildContentPageRequest(
      bearerAuth({ baseUrl: "http://localhost:9999" }),
      "saved",
      100,
    );
    expect(params.url).toStartWith("http://localhost:9999/");
  });

  test("buildMeRequest accepts custom baseUrl via auth context", () => {
    const params = buildMeRequest(bearerAuth({ baseUrl: "http://localhost:9999" }));
    expect(params.url).toBe("http://localhost:9999/api/v1/me");
  });

  test("buildUnsaveRequest accepts custom baseUrl via auth context", () => {
    const params = buildUnsaveRequest(bearerAuth({ baseUrl: "http://localhost:9999" }), "t3_abc");
    expect(params.url).toBe("http://localhost:9999/api/unsave");
  });
});

describe("input clamping", () => {
  test("buildContentPageRequest clamps pageSize to [1, 100]", () => {
    const low = buildContentPageRequest(bearerAuth(), "saved", 0);
    expect(low.url).toContain("limit=1");

    const high = buildContentPageRequest(bearerAuth(), "saved", 999);
    expect(high.url).toContain("limit=100");
  });

  test("buildCommentsRequest clamps limit to [1, 100] and depth to [1, 10]", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc", 0, 0);
    expect(params.url).toContain("limit=1");
    expect(params.url).toContain("depth=1");

    const high = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc", 999, 99);
    expect(high.url).toContain("limit=100");
    expect(high.url).toContain("depth=10");
  });
});

describe("permalink validation", () => {
  test("buildCommentsRequest accepts valid /r/ permalink", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/typescript/comments/abc123")).not.toThrow();
  });

  test("buildCommentsRequest accepts valid /u/ permalink", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/u/testuser/comments/abc123")).not.toThrow();
  });

  test("buildCommentsRequest rejects permalink with query string", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc?inject=true")).toThrow(
      "must not contain",
    );
  });

  test("buildCommentsRequest rejects permalink with hash", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc#fragment")).toThrow(
      "must not contain",
    );
  });

  test("buildCommentsRequest rejects permalink with path traversal", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/../../../admin")).toThrow(
      "must not contain",
    );
  });

  test("buildCommentsRequest rejects permalink not starting with /r/ or /u/", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/api/v1/me")).toThrow("must start with");
  });

  test("buildCommentContextRequest validates permalink", () => {
    expect(() => buildCommentContextRequest(bearerAuth(), "/api/evil?x=1")).toThrow(
      "must start with",
    );
  });

  test("rejects permalink with tab character", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc\tdef")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with null byte", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc\x00def")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with newline", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc\ndef")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with space character", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc def")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with non-ASCII unicode", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc\u2028def")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with percent-encoded CRLF", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc%0D%0Aevil")).toThrow(
      "must not contain",
    );
  });

  test("rejects permalink with percent-encoded slash", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc%2Fdef")).toThrow(
      "must not contain",
    );
  });

  test("rejects permalink with any percent encoding", () => {
    expect(() => buildCommentsRequest(bearerAuth(), "/r/test/comments/abc%20def")).toThrow(
      "must not contain",
    );
  });

  test("accepts normal permalink without percent encoding", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc123/my_title");
    expect(params.url).toContain("/r/test/comments/abc123/my_title.json");
  });
});

describe("trailing slash stripping", () => {
  test("buildCommentsRequest strips trailing slash before .json", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc123/title/");
    expect(params.url).toContain("/r/test/comments/abc123/title.json");
    expect(params.url).not.toContain("/.json");
  });

  test("buildCommentsRequest strips multiple trailing slashes", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc123/title///");
    expect(params.url).toContain("/r/test/comments/abc123/title.json");
  });

  test("buildCommentContextRequest strips trailing slash before .json", () => {
    const params = buildCommentContextRequest(bearerAuth(), "/r/test/comments/abc123/title/c1/");
    expect(params.url).toContain("/r/test/comments/abc123/title/c1.json");
    expect(params.url).not.toContain("/.json");
  });

  test("buildCommentsRequest works without trailing slash (no-op)", () => {
    const params = buildCommentsRequest(bearerAuth(), "/r/test/comments/abc123/title");
    expect(params.url).toContain("/r/test/comments/abc123/title.json");
  });
});
