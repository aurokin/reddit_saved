import {
  OAUTH_DURATION,
  OAUTH_REDIRECT_URI,
  OAUTH_RESPONSE_TYPE,
  OAUTH_SCOPES,
  REDDIT_OAUTH_AUTHORIZE_URL,
} from "../constants";

export interface AuthorizeUrlParams {
  clientId: string;
  state: string;
  codeChallenge: string;
  redirectUri?: string;
}

/** Build the Reddit OAuth2 authorization URL (with PKCE S256 challenge) */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const redirectUri = params.redirectUri ?? OAUTH_REDIRECT_URI;
  const url = new URL(REDDIT_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", OAUTH_RESPONSE_TYPE);
  url.searchParams.set("state", params.state);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("duration", OAUTH_DURATION);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
