import {
  DEFAULT_REDIRECT_PORT,
  type OAuthServerHandle,
  startOAuthServer,
} from "@reddit-saved/core";
import { isHumanMode, printError, printInfo, printJson } from "../output";

export async function authLogin(
  flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const clientId =
    process.env.REDDIT_CLIENT_ID ??
    (typeof flags["client-id"] === "string" ? flags["client-id"] : undefined);
  const clientSecret =
    process.env.REDDIT_CLIENT_SECRET ??
    (typeof flags["client-secret"] === "string" ? flags["client-secret"] : undefined);

  if (!clientId) {
    printError(
      "Missing Reddit client ID. Set REDDIT_CLIENT_ID env var or pass --client-id.",
      "MISSING_CLIENT_ID",
    );
    process.exit(1);
  }
  if (!clientSecret) {
    printError(
      "Missing Reddit client secret. Set REDDIT_CLIENT_SECRET env var or pass --client-secret.",
      "MISSING_CLIENT_SECRET",
    );
    process.exit(1);
  }

  printInfo("Starting OAuth flow...");

  let handle: OAuthServerHandle;
  try {
    handle = await startOAuthServer({
      clientId,
      clientSecret,
      onAuthorizeUrl: (url) => {
        printInfo(`Open this URL to authenticate:\n\n  ${url}\n`);
        openBrowser(url);
      },
      onSuccess: (username) => {
        if (isHumanMode()) {
          printInfo(`\nAuthenticated as ${username}`);
        }
      },
      onError: (error) => {
        printError(error.message);
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err ? String(err.code) : undefined;
    if (
      code === "EADDRINUSE" ||
      message.includes("EADDRINUSE") ||
      message.includes("address already in use") ||
      message.includes(`port ${DEFAULT_REDIRECT_PORT} in use`)
    ) {
      printError(
        `OAuth callback port ${DEFAULT_REDIRECT_PORT} is already in use. Close the other login flow or free that port and retry.`,
        "OAUTH_PORT_IN_USE",
      );
      process.exit(1);
    }
    throw err;
  }

  try {
    await handle.done;
    if (!isHumanMode()) {
      printJson({ authenticated: true });
    }
  } catch (err) {
    // Error already printed via onError callback
    process.exit(1);
  }
}

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];

    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Silently fail — the URL is printed to stderr for manual use
  }
}
