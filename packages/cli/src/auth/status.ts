import { TokenManager } from "@reddit-saved/core";
import { isHumanMode, printJson, printSection } from "../output";

export async function authStatus(
  _flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const tokenManager = new TokenManager();
  const settings = await tokenManager.load({ requireClientSecret: false });

  if (!settings) {
    if (isHumanMode()) {
      console.log("OAuth not authenticated. Run 'reddit-saved auth login' to connect.");
    } else {
      printJson({ authenticated: false, mode: "oauth" });
    }
    return;
  }

  const now = Date.now();
  const expired = settings.tokenExpiry <= now;
  const expiresIn = expired ? 0 : Math.floor((settings.tokenExpiry - now) / 1000);

  if (isHumanMode()) {
    printSection("OAuth Authentication", [
      ["Username", settings.username || "(unknown)"],
      ["Client ID", settings.clientId],
      ["Token status", expired ? "EXPIRED" : `valid (${formatExpiry(expiresIn)})`],
    ]);
  } else {
    printJson({
      authenticated: true,
      mode: "oauth",
      username: settings.username,
      clientId: settings.clientId,
      tokenExpired: expired,
      tokenExpiresIn: expiresIn,
    });
  }
}

function formatExpiry(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
