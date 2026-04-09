import { describe, expect, test } from "bun:test";
import { buildAuthorizeUrl } from "../src/auth/oauth-urls";
import {
  OAUTH_DURATION,
  OAUTH_REDIRECT_URI,
  OAUTH_RESPONSE_TYPE,
  OAUTH_SCOPES,
  REDDIT_OAUTH_AUTHORIZE_URL,
} from "../src/constants";

describe("buildAuthorizeUrl", () => {
  const defaultParams = {
    clientId: "test-client-id",
    state: "test-state-token",
    codeChallenge: "test-challenge",
  };

  test("includes all required OAuth parameters", () => {
    const url = new URL(buildAuthorizeUrl(defaultParams));

    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("response_type")).toBe(OAUTH_RESPONSE_TYPE);
    expect(url.searchParams.get("state")).toBe("test-state-token");
    expect(url.searchParams.get("duration")).toBe(OAUTH_DURATION);
    expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPES);
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("uses default redirect URI when none provided", () => {
    const url = new URL(buildAuthorizeUrl(defaultParams));
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URI);
  });

  test("uses custom redirect URI when provided", () => {
    const url = new URL(
      buildAuthorizeUrl({
        ...defaultParams,
        redirectUri: "http://example.com/callback",
      }),
    );
    expect(url.searchParams.get("redirect_uri")).toBe("http://example.com/callback");
  });

  test("URL base matches Reddit OAuth authorize URL", () => {
    const url = new URL(buildAuthorizeUrl(defaultParams));
    expect(`${url.origin}${url.pathname}`).toBe(REDDIT_OAUTH_AUTHORIZE_URL);
  });
});
