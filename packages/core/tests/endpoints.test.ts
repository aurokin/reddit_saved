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
    const params = buildContentPageRequest("tok", "user1", "saved", 100, "ua");
    expect(params.url).toBe(`${REDDIT_OAUTH_BASE_URL}/user/user1/saved?limit=100`);
    expect(params.method).toBe("GET");
    expect(params.headers?.Authorization).toBe("Bearer tok");
    expect(params.headers?.["User-Agent"]).toBe("ua");
  });

  test("appends after cursor when provided", () => {
    const params = buildContentPageRequest("tok", "user1", "saved", 100, "ua", "cursor123");
    expect(params.url).toContain("&after=cursor123");
  });

  test("does not append after when null", () => {
    const params = buildContentPageRequest("tok", "user1", "upvoted", 50, "ua", null);
    expect(params.url).not.toContain("after");
  });
});

describe("buildUnsaveRequest", () => {
  test("builds POST request with correct body and headers", () => {
    const params = buildUnsaveRequest("tok", "t3_abc123", "ua");
    expect(params.method).toBe("POST");
    expect(params.url).toBe(`${REDDIT_OAUTH_BASE_URL}/api/unsave`);
    expect(params.body).toBe("id=t3_abc123");
    expect(params.headers?.["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(params.headers?.Authorization).toBe("Bearer tok");
  });
});

describe("buildMeRequest", () => {
  test("builds GET request to /api/v1/me", () => {
    const params = buildMeRequest("tok", "ua");
    expect(params.url).toBe(`${REDDIT_OAUTH_BASE_URL}/api/v1/me`);
    expect(params.method).toBe("GET");
    expect(params.headers?.Authorization).toBe("Bearer tok");
  });
});

describe("buildCommentsRequest", () => {
  test("builds URL with defaults", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc", "ua");
    expect(params.url).toContain("/r/test/comments/abc.json");
    expect(params.url).toContain("limit=100");
    expect(params.url).toContain("depth=5");
    expect(params.url).toContain("sort=top");
  });

  test("respects custom parameters", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc", "ua", 50, 3, "new");
    expect(params.url).toContain("limit=50");
    expect(params.url).toContain("depth=3");
    expect(params.url).toContain("sort=new");
  });
});

describe("buildCommentContextRequest", () => {
  test("builds URL with context parameter", () => {
    const params = buildCommentContextRequest("tok", "/r/test/comments/abc/xyz", "ua", 5);
    expect(params.url).toContain("context=5");
  });

  test("clamps context depth to 1-10", () => {
    const low = buildCommentContextRequest("tok", "/r/test/comments/abc/xyz", "ua", 0);
    expect(low.url).toContain("context=1");

    const high = buildCommentContextRequest("tok", "/r/test/comments/abc/xyz", "ua", 99);
    expect(high.url).toContain("context=10");
  });
});

describe("buildCommentThreadRequest", () => {
  test("builds correct URL", () => {
    const params = buildCommentThreadRequest("tok", "abc123", "typescript", "ua", "new");
    expect(params.url).toContain("/r/typescript/comments/abc123.json");
    expect(params.url).toContain("sort=new");
  });

  test("defaults to sort=best", () => {
    const params = buildCommentThreadRequest("tok", "abc123", "typescript", "ua");
    expect(params.url).toContain("sort=best");
  });
});

describe("URL encoding", () => {
  test("buildContentPageRequest encodes special characters in username", () => {
    const params = buildContentPageRequest("tok", "user with spaces", "saved", 100, "ua");
    expect(params.url).toContain("/user/user%20with%20spaces/");
    expect(params.url).not.toContain("user with spaces");
  });

  test("buildContentPageRequest encodes after cursor", () => {
    const params = buildContentPageRequest("tok", "user1", "saved", 100, "ua", "t3_abc=123&foo");
    expect(params.url).toContain("after=t3_abc%3D123%26foo");
  });

  test("buildContentPageRequest encodes endpoint", () => {
    const params = buildContentPageRequest("tok", "user1", "saved&extra", 100, "ua");
    expect(params.url).toContain("/saved%26extra?");
  });

  test("buildUnsaveRequest encodes fullname in body", () => {
    const params = buildUnsaveRequest("tok", "t3_abc=def", "ua");
    expect(params.body).toBe("id=t3_abc%3Ddef");
  });

  test("buildCommentThreadRequest encodes subreddit and sort", () => {
    const params = buildCommentThreadRequest("tok", "abc", "sub/reddit", "ua", "top&malicious");
    expect(params.url).toContain("/r/sub%2Freddit/");
    expect(params.url).toContain("sort=top%26malicious");
  });

  test("buildCommentThreadRequest encodes postId", () => {
    const params = buildCommentThreadRequest("tok", "abc/def", "typescript", "ua");
    expect(params.url).toContain("/comments/abc%2Fdef.json");
  });

  test("buildCommentsRequest encodes sort parameter", () => {
    const params = buildCommentsRequest(
      "tok",
      "/r/test/comments/abc",
      "ua",
      100,
      5,
      "new&bad" as "new",
    );
    expect(params.url).toContain("sort=new%26bad");
  });

  test("buildCommentsRequest rejects percent-encoded permalink", () => {
    // Reddit permalinks don't use percent-encoding; reject to prevent injection
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc%20def", "ua")).toThrow(
      "must not contain",
    );
  });

  test("buildContentPageRequest accepts custom baseUrl", () => {
    const params = buildContentPageRequest(
      "tok",
      "user1",
      "saved",
      100,
      "ua",
      null,
      "http://localhost:9999",
    );
    expect(params.url).toStartWith("http://localhost:9999/");
  });

  test("buildMeRequest accepts custom baseUrl", () => {
    const params = buildMeRequest("tok", "ua", "http://localhost:9999");
    expect(params.url).toBe("http://localhost:9999/api/v1/me");
  });

  test("buildUnsaveRequest accepts custom baseUrl", () => {
    const params = buildUnsaveRequest("tok", "t3_abc", "ua", "http://localhost:9999");
    expect(params.url).toBe("http://localhost:9999/api/unsave");
  });
});

describe("input clamping", () => {
  test("buildContentPageRequest clamps pageSize to [1, 100]", () => {
    const low = buildContentPageRequest("tok", "user1", "saved", 0, "ua");
    expect(low.url).toContain("limit=1");

    const high = buildContentPageRequest("tok", "user1", "saved", 999, "ua");
    expect(high.url).toContain("limit=100");
  });

  test("buildCommentsRequest clamps limit to [1, 100] and depth to [1, 10]", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc", "ua", 0, 0);
    expect(params.url).toContain("limit=1");
    expect(params.url).toContain("depth=1");

    const high = buildCommentsRequest("tok", "/r/test/comments/abc", "ua", 999, 99);
    expect(high.url).toContain("limit=100");
    expect(high.url).toContain("depth=10");
  });
});

describe("permalink validation", () => {
  test("buildCommentsRequest accepts valid /r/ permalink", () => {
    expect(() => buildCommentsRequest("tok", "/r/typescript/comments/abc123", "ua")).not.toThrow();
  });

  test("buildCommentsRequest accepts valid /u/ permalink", () => {
    expect(() => buildCommentsRequest("tok", "/u/testuser/comments/abc123", "ua")).not.toThrow();
  });

  test("buildCommentsRequest rejects permalink with query string", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc?inject=true", "ua")).toThrow(
      "must not contain",
    );
  });

  test("buildCommentsRequest rejects permalink with hash", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc#fragment", "ua")).toThrow(
      "must not contain",
    );
  });

  test("buildCommentsRequest rejects permalink with path traversal", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/../../../admin", "ua")).toThrow(
      "must not contain",
    );
  });

  test("buildCommentsRequest rejects permalink not starting with /r/ or /u/", () => {
    expect(() => buildCommentsRequest("tok", "/api/v1/me", "ua")).toThrow("must start with");
  });

  test("buildCommentContextRequest validates permalink", () => {
    expect(() => buildCommentContextRequest("tok", "/api/evil?x=1", "ua")).toThrow(
      "must start with",
    );
  });

  test("rejects permalink with tab character", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc\tdef", "ua")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with null byte", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc\x00def", "ua")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with newline", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc\ndef", "ua")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with space character", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc def", "ua")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with non-ASCII unicode", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc\u2028def", "ua")).toThrow(
      "printable ASCII",
    );
  });

  test("rejects permalink with percent-encoded CRLF", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc%0D%0Aevil", "ua")).toThrow(
      "must not contain",
    );
  });

  test("rejects permalink with percent-encoded slash", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc%2Fdef", "ua")).toThrow(
      "must not contain",
    );
  });

  test("rejects permalink with any percent encoding", () => {
    expect(() => buildCommentsRequest("tok", "/r/test/comments/abc%20def", "ua")).toThrow(
      "must not contain",
    );
  });

  test("accepts normal permalink without percent encoding", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc123/my_title", "ua");
    expect(params.url).toContain("/r/test/comments/abc123/my_title.json");
  });
});

describe("trailing slash stripping", () => {
  test("buildCommentsRequest strips trailing slash before .json", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc123/title/", "ua");
    expect(params.url).toContain("/r/test/comments/abc123/title.json");
    expect(params.url).not.toContain("/.json");
  });

  test("buildCommentsRequest strips multiple trailing slashes", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc123/title///", "ua");
    expect(params.url).toContain("/r/test/comments/abc123/title.json");
  });

  test("buildCommentContextRequest strips trailing slash before .json", () => {
    const params = buildCommentContextRequest("tok", "/r/test/comments/abc123/title/c1/", "ua");
    expect(params.url).toContain("/r/test/comments/abc123/title/c1.json");
    expect(params.url).not.toContain("/.json");
  });

  test("buildCommentsRequest works without trailing slash (no-op)", () => {
    const params = buildCommentsRequest("tok", "/r/test/comments/abc123/title", "ua");
    expect(params.url).toContain("/r/test/comments/abc123/title.json");
  });
});
