import { TokenManager } from "@reddit-saved/core";
import { isHumanMode, printInfo, printJson } from "../output";

export async function authLogout(
  _flags: Record<string, string | boolean>,
  _positionals: string[],
): Promise<void> {
  const tokenManager = new TokenManager();
  await tokenManager.logout();

  if (isHumanMode()) {
    printInfo("Logged out. OAuth credentials cleared.");
  } else {
    printJson({ loggedOut: true, mode: "oauth" });
  }
}
